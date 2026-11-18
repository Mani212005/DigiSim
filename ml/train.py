"""
Module: train.py
Purpose: Trains the DigiSim symbol detector via YOLO transfer learning (pretrained weights -
         never random init) on CPU, one GPU or several GPUs (DDP) with the same command.
         Two presets drive the real pipeline: `stage-a` (synthetic pretrain) and `stage-b`
         (mixed fine-tune of the stage-A weights with real images oversampled); `smoke` is a
         2-epoch CPU check. Every run writes a flat artifact folder (config.yaml, notes.md,
         best.pt, best.onnx, metrics.json) under ml/experiments/ (gitignored) and can be
         resumed. ml/kaggle/train_kaggle.py is the single-file Kaggle twin of this harness.

Usage:
    cd ml
    uv run python train.py --preset smoke --data /path/to/data.yaml --device cpu
    uv run python train.py --preset stage-a --data /path/to/synthetic/data.yaml --device 0,1,2,3
    uv run python train.py --preset stage-b --data /path/to/mixed/data.yaml --model runs/stage_a/best.pt --real-train /path/to/real/images/train
    uv run python train.py --preset stage-a --data data.yaml --device 0,1,2,3 --dry-run     # print the plan, train nothing
    uv run python train.py --resume experiments/run_YYYYMMDD_HHMM                          # continue an interrupted run
"""

import argparse
import json
import os
import platform
import shutil
import sys
import time
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import yaml

from class_schema import TIER_ORDER, load_schema

ML_DIR = Path(__file__).resolve().parent
REPO_ROOT = ML_DIR.parent
DEFAULT_PROJECT = ML_DIR / "experiments"
DEFAULT_DATA = ML_DIR / "dataset" / "data.yaml"
WEIGHTS_DST = REPO_ROOT / "backend" / "model" / "weights" / "best.pt"
IMAGE_SUFFIXES = frozenset({".jpg", ".jpeg", ".png", ".bmp", ".webp"})
F1_THRESHOLD = 0.95
ACC_THRESHOLD = 0.95
METRICS_SCHEMA_VERSION = 1
ONNX_OPSET = 17
SEED = 0


@dataclass(frozen=True)
class Preset:
    """Default hyper-parameters of one training stage; every field can be overridden on the CLI."""

    name: str
    description: str
    model: str | None
    imgsz: int
    epochs: int
    batch_per_device: int
    patience: int
    lr0: float
    lrf: float
    warmup_epochs: float
    close_mosaic: int
    real_oversample: int
    plots: bool


# Augmentation profiles (ultralytics train hyperparameters on top of its defaults). "strong" targets real hand-drawn
# photos: lighting/paper colour (hsv), small rotation, shear and perspective of a hand-held camera, wider scale range
# for small junctions, and light mixup. Keep this table equal to ml/kaggle/train_kaggle.py (tests assert it).
AUGMENT_PROFILES: dict[str, dict[str, float]] = {
    "default": {},
    "strong": {"hsv_s": 0.6, "hsv_v": 0.5, "degrees": 5.0, "translate": 0.15, "scale": 0.6, "shear": 2.0, "perspective": 0.0005, "mixup": 0.1},
}

PRESETS: dict[str, Preset] = {
    "smoke": Preset("smoke", "2-epoch CPU check of the whole harness (train, val, ONNX export, metrics.json)", "yolov8n.pt", 320, 2, 8, 2, 0.01, 0.01, 0.0, 0, 1, False),
    "stage-a": Preset("stage-a", "synthetic pretrain: COCO-pretrained yolov8s on synthetic data", "yolov8s.pt", 960, 100, 16, 20, 0.01, 0.01, 3.0, 10, 1, True),
    "stage-b": Preset("stage-b", "mixed fine-tune: continue from the stage-A weights with real images oversampled", None, 960, 40, 16, 15, 0.002, 0.1, 1.0, 5, 4, True),
}
DEFAULT_PRESET = "stage-a"


@dataclass(frozen=True)
class DevicePlan:
    """A resolved compute target: the CPU, or one or more CUDA device indices (more than one means DDP)."""

    ids: tuple[int, ...]

    @property
    def is_cpu(self) -> bool:
        """
        Whether training runs on the CPU.

        Returns:
            True when no CUDA device was requested.
        """
        return not self.ids

    @property
    def world_size(self) -> int:
        """
        Number of training processes (1 for CPU or a single GPU).

        Returns:
            DDP world size.
        """
        return max(1, len(self.ids))

    @property
    def spec(self) -> str:
        """
        The device string handed to ultralytics.

        Returns:
            'cpu' or a comma-separated index list such as '0,1,2,3'.
        """
        return "cpu" if self.is_cpu else ",".join(str(i) for i in self.ids)


@dataclass(frozen=True)
class TrainConfig:
    """Fully resolved settings of one run (preset defaults merged with CLI overrides)."""

    preset: str
    model: str
    data: Path
    project: Path
    name: str
    epochs: int
    time_hours: float | None
    imgsz: int
    batch: int
    device: DevicePlan
    workers: int
    patience: int
    lr0: float
    lrf: float
    warmup_epochs: float
    close_mosaic: int
    plots: bool
    augment: str
    seed: int
    real_train: tuple[Path, ...]
    real_oversample: int
    resume: Path | None
    class_check: str
    install_weights: bool
    notes: str

    @property
    def run_dir(self) -> Path:
        """
        Directory that holds this run's artifacts.

        Returns:
            project / name.
        """
        return self.project / self.name


def default_workers() -> int:
    """
    Default dataloader worker count derived from the CPUs this process may use.

    Returns:
        A value in [1, 8] (the CPU count, capped; cgroup/affinity aware where the OS exposes it).
    """
    try:
        cpus = len(os.sched_getaffinity(0))
    except AttributeError:  # not available on macOS / Windows
        cpus = os.cpu_count() or 1
    return max(1, min(8, cpus))


def detect_cuda_count() -> int:
    """
    Count visible CUDA devices without requiring torch to be installed.

    Returns:
        Number of CUDA devices, 0 when torch is missing or no GPU is visible.
    """
    try:
        import torch
    except ImportError:
        return 0
    return int(torch.cuda.device_count())


def parse_device(spec: str, cuda_count: int | None = None) -> DevicePlan:
    """
    Parse a --device value into a DevicePlan (pure string handling, so it works without a GPU).

    Args:
        spec: 'cpu', 'auto' (all visible GPUs, else CPU), '0', or a comma list like '0,1,2,3'.
        cuda_count: Visible GPU count used by 'auto'; detected via torch when None.
    Returns:
        The resolved plan.
    Raises:
        ValueError: If the spec is empty, malformed, negative or lists a device twice.
    """
    text = spec.strip().lower().replace(" ", "")
    if text == "cpu":
        return DevicePlan(())
    if text == "auto":
        count = detect_cuda_count() if cuda_count is None else cuda_count
        return DevicePlan(tuple(range(count)))
    parts = [p for p in text.removeprefix("cuda:").split(",") if p != ""]
    try:
        ids = tuple(int(p.removeprefix("cuda:")) for p in parts)
    except ValueError as exc:
        raise ValueError(f"Bad --device {spec!r}: use 'cpu', 'auto', '0' or '0,1,2,3'") from exc
    if not ids or any(i < 0 for i in ids) or len(set(ids)) != len(ids):
        raise ValueError(f"Bad --device {spec!r}: need unique non-negative device indices")
    return DevicePlan(ids)


def resolve_batch(requested: int | None, per_device: int, plan: DevicePlan) -> int:
    """
    Resolve the total batch size (ultralytics splits it evenly across DDP processes).

    Args:
        requested: Total batch from --batch, or None for per-device default x world size.
        per_device: Preset batch per device.
        plan: Resolved device plan.
    Returns:
        The total batch size.
    Raises:
        ValueError: If the batch is not positive or not divisible by the GPU count (-1 auto-batch is single-device only).
    """
    batch = per_device * plan.world_size if requested is None else requested
    if batch == -1 and plan.world_size == 1:
        return batch
    if batch < 1:
        raise ValueError(f"batch must be >= 1 (got {batch}); -1 auto-batch is single-device only")
    if batch % plan.world_size:
        raise ValueError(f"batch {batch} must be a multiple of the GPU count {plan.world_size} for DDP")
    return batch


def load_data_yaml(path: Path) -> dict[str, object]:
    """
    Read a YOLO dataset yaml.

    Args:
        path: Path to data.yaml.
    Returns:
        The parsed mapping.
    Raises:
        FileNotFoundError: If the file does not exist.
        ValueError: If it is not a mapping with train, val and names.
    """
    if not path.is_file():
        raise FileNotFoundError(f"{path} not found - generate a dataset first (class_schema.py data-yaml writes the yaml for it)")
    cfg = yaml.safe_load(path.read_text())
    if not isinstance(cfg, dict) or not {"train", "val", "names"} <= cfg.keys():
        raise ValueError(f"{path}: expected a YOLO data.yaml with train, val and names")
    return cfg


def dataset_names(cfg: dict[str, object]) -> list[str]:
    """
    Class names of a data.yaml in id order (list or {id: name} form).

    Args:
        cfg: Parsed data.yaml.
    Returns:
        Names indexed by class id.
    Raises:
        ValueError: If names is neither a list nor a mapping, or ids are not contiguous from 0.
    """
    names = cfg["names"]
    if isinstance(names, dict):
        if sorted(int(k) for k in names) != list(range(len(names))):
            raise ValueError("data.yaml names ids must be contiguous from 0")
        return [str(names[k]) for k in sorted(names, key=int)]
    if isinstance(names, list):
        return [str(n) for n in names]
    raise ValueError("data.yaml names must be a list or an {id: name} mapping")


def check_class_vocabulary(names: Sequence[str]) -> str:
    """
    Verify a dataset uses the canonical vocabulary from ml/classes.yaml (a full tier prefix).

    Args:
        names: Class names in id order from the dataset yaml.
    Returns:
        The tier ('A' or 'B') whose class list matches.
    Raises:
        ValueError: If the names match no tier, i.e. the dataset drifted from classes.yaml.
    """
    schema = load_schema()
    for tier in TIER_ORDER:
        if list(names) == [c.name for c in schema.classes_up_to(tier)]:
            return tier
    raise ValueError(f"Dataset classes {list(names)} do not match ml/classes.yaml tier A or B; regenerate data.yaml with `class_schema.py data-yaml` (or pass --class-check off)")


def list_images(entries: Iterable[Path]) -> list[Path]:
    """
    Expand image files, image directories and .txt image lists into a sorted image list.

    Args:
        entries: Paths to images, directories (searched recursively) or .txt lists (one path per line).
    Returns:
        Absolute image paths, de-duplicated, sorted.
    """
    found: set[Path] = set()
    for entry in entries:
        if entry.is_dir():
            found.update(p.resolve() for p in entry.rglob("*") if p.suffix.lower() in IMAGE_SUFFIXES)
        elif entry.suffix == ".txt" and entry.is_file():
            for line in entry.read_text().splitlines():
                if line.strip():
                    p = Path(line.strip())
                    found.add((entry.parent / p if not p.is_absolute() else p).resolve())
        elif entry.suffix.lower() in IMAGE_SUFFIXES and entry.is_file():
            found.add(entry.resolve())
    return sorted(found)


def split_images(cfg: dict[str, object], data_yaml: Path, split: str) -> list[Path]:
    """
    Images of one split of a dataset yaml (empty when the split is not declared).

    Args:
        cfg: Parsed data.yaml.
        data_yaml: Where the yaml lives (relative `path:` values resolve against its folder).
        split: 'train', 'val' or 'test'.
    Returns:
        Sorted absolute image paths.
    """
    value = cfg.get(split)
    if not value:
        return []
    root = Path(str(cfg["path"])) if cfg.get("path") else data_yaml.parent
    if not root.is_absolute():
        root = data_yaml.parent / root
    items = value if isinstance(value, list) else [value]
    return list_images(root / str(item) for item in items)


def build_mixed_dataset(data_yaml: Path, real_dirs: Sequence[Path], factor: int, out_dir: Path) -> Path:
    """
    Write a derived data yaml whose train list repeats real images `factor` times (stage-B oversampling).

    Args:
        data_yaml: The base dataset yaml (synthetic plus whatever real images it already lists).
        real_dirs: Image folders (or .txt lists) holding the real training images.
        factor: How often each real image appears per epoch (1 = no oversampling).
        out_dir: Where train_mixed.txt and data_mixed.yaml are written.
    Returns:
        Path of the derived data yaml.
    Raises:
        ValueError: If factor < 1, no real image was found, or a real image is also in val/test (leakage).
    """
    if factor < 1:
        raise ValueError("real oversample factor must be >= 1")
    cfg = load_data_yaml(data_yaml)
    real = list_images(real_dirs)
    if not real:
        raise ValueError(f"No images found under --real-train {[str(d) for d in real_dirs]}")
    held_out = set(split_images(cfg, data_yaml, "val")) | set(split_images(cfg, data_yaml, "test"))
    leaked = sorted(held_out & set(real))
    if leaked:
        raise ValueError(f"{len(leaked)} real training image(s) are also in val/test, e.g. {leaked[0]}")
    real_set = set(real)
    lines = [str(p) for p in split_images(cfg, data_yaml, "train") if p not in real_set]
    lines += [str(p) for p in real for _ in range(factor)]
    out_dir.mkdir(parents=True, exist_ok=True)
    train_list = out_dir / "train_mixed.txt"
    train_list.write_text("\n".join(lines) + "\n")
    root = Path(str(cfg["path"])) if cfg.get("path") else data_yaml.parent
    derived = {**cfg, "path": str((root if root.is_absolute() else data_yaml.parent / root).resolve()), "train": str(train_list)}
    out_yaml = out_dir / "data_mixed.yaml"
    out_yaml.write_text(yaml.safe_dump(derived, sort_keys=False))
    return out_yaml


def resolve_resume_checkpoint(target: Path) -> Path:
    """
    Locate last.pt from a run directory, a train directory or the checkpoint itself.

    Args:
        target: A run dir, its train/ subdir, or a last.pt path.
    Returns:
        Path to last.pt.
    Raises:
        FileNotFoundError: If no checkpoint is found.
    """
    for candidate in (target, target / "weights" / "last.pt", target / "train" / "weights" / "last.pt", target / "last.pt"):
        if candidate.is_file() and candidate.suffix == ".pt":
            return candidate
    raise FileNotFoundError(f"No last.pt checkpoint found for --resume {target}")


def load_saved_config(run_dir: Path) -> dict[str, object]:
    """
    Read the config.yaml a previous run wrote, so --resume can reuse its preset, data and image size.

    Args:
        run_dir: The run directory.
    Returns:
        The saved mapping, empty when the run has no readable config.yaml.
    """
    path = run_dir / "config.yaml"
    if not path.is_file():
        return {}
    loaded = yaml.safe_load(path.read_text())
    return loaded if isinstance(loaded, dict) else {}


def resolve_config(args: argparse.Namespace) -> TrainConfig:
    """
    Merge the preset defaults with CLI overrides and validate the combination.

    Args:
        args: Parsed CLI arguments.
    Returns:
        The resolved TrainConfig.
    Raises:
        ValueError: If the device, batch, stage-B model or oversample settings are invalid.
        FileNotFoundError: If --resume points at nothing.
    """
    plan = parse_device(args.device)
    resume = resolve_resume_checkpoint(args.resume) if args.resume else None
    saved = load_saved_config(resume.parent.parent.parent) if resume else {}
    preset = PRESETS[args.preset or str(saved.get("preset") or DEFAULT_PRESET)]
    model = str(saved.get("model") or resume) if resume else (args.model or preset.model)  # a resumed run keeps its original base weights on record
    if model is None:
        raise ValueError(f"preset {preset.name} fine-tunes earlier weights: pass --model path/to/stage_a/best.pt")
    saved_real = [Path(str(p)) for p in saved.get("real_train") or []]
    real_train = tuple(args.real_train or saved_real)
    inherited = not args.real_train and bool(saved_real)
    default_oversample = int(saved.get("real_oversample") or 1) if inherited else (preset.real_oversample if real_train else 1)
    oversample = args.real_oversample if args.real_oversample is not None else default_oversample
    saved_batch = int(str(saved["batch"])) if resume and saved.get("batch") else None  # resume keeps the original total batch unless --batch says otherwise
    if oversample > 1 and not real_train:
        raise ValueError("--real-oversample needs at least one --real-train folder")
    return TrainConfig(
        preset=preset.name,
        model=model,
        data=args.data or Path(str(saved.get("data") or DEFAULT_DATA)),
        project=resume.parent.parent.parent.parent if resume else args.project,
        name=resume.parent.parent.parent.name if resume else (args.name or f"run_{datetime.now():%Y%m%d_%H%M}"),
        epochs=args.epochs if args.epochs is not None else int(saved.get("epochs") or preset.epochs),
        time_hours=args.time if args.time is not None else (float(str(saved["time_hours"])) if saved.get("time_hours") else None),
        imgsz=args.imgsz if args.imgsz is not None else int(saved.get("imgsz") or preset.imgsz),
        batch=resolve_batch(args.batch if args.batch is not None else saved_batch, preset.batch_per_device, plan),
        device=plan,
        workers=args.workers if args.workers is not None else default_workers(),
        patience=args.patience if args.patience is not None else int(saved.get("patience") or preset.patience),
        lr0=args.lr0 if args.lr0 is not None else float(saved.get("lr0") or preset.lr0),
        lrf=preset.lrf,
        warmup_epochs=preset.warmup_epochs,
        close_mosaic=preset.close_mosaic,
        plots=preset.plots if args.plots is None else args.plots,
        augment=args.augment or str(saved.get("augment") or "default"),
        seed=args.seed if args.seed is not None else int(saved.get("seed") or SEED),
        real_train=real_train,
        real_oversample=oversample,
        resume=resume,
        class_check=args.class_check,
        install_weights=args.install_weights,
        notes=args.notes,
    )


def describe_plan(cfg: TrainConfig) -> dict[str, object]:
    """
    Build the dry-run report: resolved settings, launch topology and dataset sanity (never raises on dataset problems).

    Args:
        cfg: Resolved configuration.
    Returns:
        JSON-serialisable plan.
    """
    warnings: list[str] = []
    dataset: dict[str, object] = {"data": str(cfg.data)}
    try:
        data_cfg = load_data_yaml(cfg.data)
        names = dataset_names(data_cfg)
        dataset["classes"] = len(names)
        dataset["eval_split"] = "test" if data_cfg.get("test") else "val"
        for split in ("train", "val", "test"):
            dataset[f"{split}_images"] = len(split_images(data_cfg, cfg.data, split))
        if cfg.class_check == "strict":
            dataset["tier"] = check_class_vocabulary(names)
        if not dataset["train_images"]:
            warnings.append("train split has no images")
    except (FileNotFoundError, ValueError) as exc:
        warnings.append(f"dataset: {exc}")
    if cfg.model.endswith(".pt") and not Path(cfg.model).is_file() and cfg.resume is None and Path(cfg.model).name == cfg.model:
        warnings.append(f"{cfg.model} is a pretrained-weights name that ultralytics downloads on first use")
    return {
        "preset": cfg.preset,
        "model": cfg.model,
        "device": {"spec": cfg.device.spec, "cpu": cfg.device.is_cpu, "world_size": cfg.device.world_size, "ddp": cfg.device.world_size > 1},
        "batch_total": cfg.batch,
        "batch_per_process": cfg.batch // cfg.device.world_size if cfg.batch > 0 else cfg.batch,
        "workers": cfg.workers,
        "epochs": cfg.epochs,
        "time_hours": cfg.time_hours,
        "imgsz": cfg.imgsz,
        "lr0": cfg.lr0,
        "patience": cfg.patience,
        "augment": cfg.augment,
        "real_train": [str(p) for p in cfg.real_train],
        "real_oversample": cfg.real_oversample,
        "resume": str(cfg.resume) if cfg.resume else None,
        "run_dir": str(cfg.run_dir),
        "dataset": dataset,
        "warnings": warnings,
    }


def per_class_metrics(box: Any, names: dict[int, str], confusion: Any, instances: Any) -> dict[str, dict[str, float]]:
    """
    Per-class precision/recall/F1/AP/accuracy from an ultralytics validation result.

    Accuracy follows ml/evaluate.py: confusion-matrix TP divided by all ground-truth boxes of the class.

    Args:
        box: The `metrics.box` object (p, r, f1, ap50, ap, ap_class_index arrays; ultralytics is duck-typed here).
        names: Class id to name map of the model.
        confusion: The validator confusion matrix (matrix[pred, gt]) or None.
        instances: Per-class ground-truth counts array or None.
    Returns:
        Class name to metric dict; classes absent from the evaluated split are omitted.
    """
    idx = np.atleast_1d(getattr(box, "ap_class_index", [])).astype(int)
    columns = {key: np.atleast_1d(getattr(box, attr, np.zeros(len(idx)))) for key, attr in (("precision", "p"), ("recall", "r"), ("f1", "f1"), ("ap50", "ap50"), ("ap50_95", "ap"))}
    counts = None if instances is None else np.atleast_1d(instances)
    matrix = getattr(confusion, "matrix", None)
    out: dict[str, dict[str, float]] = {}
    for pos, cls_id in enumerate(idx):
        entry = {key: float(col[pos]) for key, col in columns.items()}
        if counts is not None and cls_id < len(counts):
            entry["instances"] = float(counts[cls_id])
        if matrix is not None and cls_id < matrix.shape[1] and matrix[:, cls_id].sum() > 0:
            entry["accuracy"] = float(matrix[cls_id, cls_id]) / float(matrix[:, cls_id].sum())
        out[names[int(cls_id)]] = entry
    return out


def gate_verdict(per_class: dict[str, dict[str, float]]) -> dict[str, object]:
    """
    Apply the AGENTS.md phase gate (F1 >= 0.95 and accuracy >= 0.95 per class) to a per-class table.

    Args:
        per_class: Output of per_class_metrics().
    Returns:
        Thresholds, failing class names and the overall pass flag (False when nothing was evaluated).
    """
    failing = [n for n, m in per_class.items() if m.get("f1", 0.0) < F1_THRESHOLD or m.get("accuracy", 0.0) < ACC_THRESHOLD]
    return {"f1_threshold": F1_THRESHOLD, "accuracy_threshold": ACC_THRESHOLD, "failing_classes": failing, "passed": bool(per_class) and not failing}


def environment_info() -> dict[str, object]:
    """
    Describe the software and hardware the run executed on.

    Returns:
        Versions, CPU count and visible GPU names (torch/ultralytics entries are None when not importable).
    """
    info: dict[str, object] = {"python": platform.python_version(), "platform": platform.platform(), "cpu_count": os.cpu_count(), "torch": None, "ultralytics": None, "cuda_devices": []}
    try:
        import torch

        info["torch"] = torch.__version__
        info["cuda_devices"] = [torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())]
    except ImportError:
        pass
    try:
        import ultralytics

        info["ultralytics"] = ultralytics.__version__
    except ImportError:
        pass
    return info


def config_dict(cfg: TrainConfig, data_effective: Path) -> dict[str, object]:
    """
    Flatten a TrainConfig into a YAML-friendly dict for config.yaml.

    Args:
        cfg: Resolved configuration.
        data_effective: The data yaml actually trained on (differs from cfg.data when oversampling).
    Returns:
        Plain-typed mapping (paths as strings, device expanded).
    """
    out: dict[str, object] = {}
    for key, value in vars(cfg).items():
        if key == "device":
            out["device"], out["world_size"] = cfg.device.spec, cfg.device.world_size
        elif isinstance(value, Path):
            out[key] = str(value)
        elif isinstance(value, tuple):
            out[key] = [str(v) for v in value]
        else:
            out[key] = value
    out["data_effective"] = str(data_effective)
    return out


def train(cfg: TrainConfig) -> Path:
    """
    Run one training experiment end to end: train, validate best.pt, export ONNX, write metrics.json.

    Args:
        cfg: Resolved configuration (see resolve_config).
    Returns:
        The run directory holding config.yaml, notes.md, best.pt, best.onnx and metrics.json.
    Raises:
        FileNotFoundError: If the dataset yaml is missing.
        ValueError: If the dataset classes drift from classes.yaml (unless --class-check off) or real-image leakage is found.
    """
    from ultralytics import YOLO

    data_cfg = load_data_yaml(cfg.data)
    if cfg.class_check == "strict":
        check_class_vocabulary(dataset_names(data_cfg))
    run_dir = cfg.run_dir
    run_dir.mkdir(parents=True, exist_ok=True)

    data_yaml = cfg.data
    if cfg.real_train:
        data_yaml = build_mixed_dataset(cfg.data, cfg.real_train, cfg.real_oversample, run_dir)
    (run_dir / "config.yaml").write_text(yaml.safe_dump(config_dict(cfg, data_yaml), sort_keys=False))
    if not (run_dir / "notes.md").exists():
        (run_dir / "notes.md").write_text(f"# {cfg.name}\n\n{cfg.notes or 'No notes provided.'}\n")

    started = time.time()
    model = YOLO(str(cfg.resume) if cfg.resume else cfg.model)  # always a pretrained checkpoint: transfer learning only
    train_kwargs: dict[str, object] = {
        "data": str(data_yaml),
        "epochs": cfg.epochs,
        "imgsz": cfg.imgsz,
        "batch": cfg.batch,
        "device": cfg.device.spec,
        **({"time": cfg.time_hours} if cfg.time_hours else {}),
        "workers": cfg.workers,
        "patience": cfg.patience,
        "seed": cfg.seed,
        "lr0": cfg.lr0,
        "lrf": cfg.lrf,
        "warmup_epochs": cfg.warmup_epochs,
        "close_mosaic": cfg.close_mosaic,
        "plots": cfg.plots,
        **AUGMENT_PROFILES[cfg.augment],
        "project": str(run_dir),
        "name": "train",
        "exist_ok": True,
    }
    if cfg.resume:
        # ultralytics keeps the original run settings from the checkpoint and only lets the overrides below be changed. `data` is
        # only its fallback for a checkpoint whose recorded dataset yaml no longer exists (moved run dir); without it ultralytics
        # silently resumes on its default coco8 instead of the mixed, oversampled dataset.
        model.train(resume=True, data=str(data_yaml), device=cfg.device.spec, batch=cfg.batch, imgsz=cfg.imgsz, workers=cfg.workers)
    else:
        model.train(**train_kwargs)
    trainer = model.trainer
    best = Path(trainer.best) if Path(trainer.best).is_file() else Path(trainer.last)
    save_dir = Path(trainer.save_dir)

    eval_split = "test" if data_cfg.get("test") else "val"
    eval_device = "cpu" if cfg.device.is_cpu else str(cfg.device.ids[0])  # final validation is single-process even after DDP
    best_model = YOLO(str(best))
    val = best_model.val(
        data=str(data_yaml),
        split=eval_split,
        imgsz=cfg.imgsz,
        batch=min(cfg.batch, 16) if cfg.batch > 0 else 16,
        device=eval_device,
        workers=0,
        plots=True,
        project=str(run_dir),
        name="val",
        exist_ok=True,
    )
    per_class = per_class_metrics(val.box, best_model.names, getattr(val, "confusion_matrix", None), getattr(val, "nt_per_class", None))
    onnx_src = Path(best_model.export(format="onnx", imgsz=cfg.imgsz, opset=ONNX_OPSET, simplify=True, dynamic=False, device="cpu"))

    shutil.copy2(best, run_dir / "best.pt")
    shutil.copy2(onnx_src, run_dir / "best.onnx")
    summary: dict[str, object] = {
        "schema_version": METRICS_SCHEMA_VERSION,
        "run_name": cfg.name,
        "preset": cfg.preset,
        "resumed_from": str(cfg.resume) if cfg.resume else None,
        "map50": float(val.box.map50),
        "map50_95": float(val.box.map),
        "mean_precision": float(val.box.mp),
        "mean_recall": float(val.box.mr),
        "eval_split": eval_split,
        "per_class": per_class,
        "gate": gate_verdict(per_class),
        "class_names": [best_model.names[i] for i in sorted(best_model.names)],
        "dataset": {
            "data": str(cfg.data),
            "data_effective": str(data_yaml),
            "train_images": len(split_images(data_cfg, cfg.data, "train")),
            "val_images": len(split_images(data_cfg, cfg.data, "val")),
            "test_images": len(split_images(data_cfg, cfg.data, "test")),
            "real_oversample": cfg.real_oversample,
        },
        "settings": {
            "model": cfg.model,
            "epochs": cfg.epochs,
            "time_hours": cfg.time_hours,
            "imgsz": cfg.imgsz,
            "batch": cfg.batch,
            "device": cfg.device.spec,
            "workers": cfg.workers,
            "seed": cfg.seed,
            "lr0": cfg.lr0,
            "augment": cfg.augment,
        },
        "environment": environment_info(),
        "train_seconds": round(time.time() - started, 1),
        "weights": str(run_dir / "best.pt"),
        "onnx": str(run_dir / "best.onnx"),
        "ultralytics_run_dir": str(save_dir),
    }
    (run_dir / "metrics.json").write_text(json.dumps(summary, indent=2))
    if cfg.install_weights:
        WEIGHTS_DST.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(best, WEIGHTS_DST)
        print(f"Best weights installed at {WEIGHTS_DST}")
    print(f"\nRun logged to {run_dir}  (best.pt, best.onnx, metrics.json)")
    print("Run `uv run python evaluate.py` for the per-class F1/accuracy gate.")
    return run_dir


def build_parser() -> argparse.ArgumentParser:
    """
    Build the CLI parser (all tunables default to None so presets can fill them in).

    Returns:
        The configured parser.
    """
    p = argparse.ArgumentParser(description="Train the DigiSim symbol detector (CPU, GPU or multi-GPU DDP)")
    p.add_argument("--preset", choices=sorted(PRESETS), default=None, help=f"default {DEFAULT_PRESET} (or the resumed run's preset). " + "; ".join(f"{k}: {v.description}" for k, v in PRESETS.items()))
    p.add_argument("--data", type=Path, default=None, help="YOLO data.yaml (default: the resumed run's data, else ml/dataset/data.yaml)")
    p.add_argument("--model", default=None, help="pretrained .pt to start from (stage-b: the stage-A best.pt)")
    p.add_argument("--device", default="auto", help="cpu | auto | 0 | 0,1,2,3 (several indices = DDP)")
    p.add_argument("--epochs", type=int, default=None)
    p.add_argument("--time", type=float, default=None, help="wall-clock training budget in hours; overrides --epochs (ultralytics fits the epoch count and LR schedule to it)")
    p.add_argument("--imgsz", type=int, default=None)
    p.add_argument("--batch", type=int, default=None, help="TOTAL batch across devices (default: preset per-device batch x GPUs)")
    p.add_argument("--workers", type=int, default=None, help="dataloader workers (default: usable CPU count, max 8)")
    p.add_argument("--patience", type=int, default=None)
    p.add_argument("--lr0", type=float, default=None)
    p.add_argument("--seed", type=int, default=None, help=f"default {SEED} (or the resumed run's seed)")
    p.add_argument("--plots", action=argparse.BooleanOptionalAction, default=None)
    p.add_argument("--augment", choices=sorted(AUGMENT_PROFILES), default=None, help="augmentation profile (default: default; strong: real-photo augmentation, see AUGMENT_PROFILES)")
    p.add_argument("--real-train", type=Path, action="append", default=[], help="real training image folder/list to oversample (repeatable)")
    p.add_argument("--real-oversample", type=int, default=None, help="times each real image repeats per epoch (stage-b default 4)")
    p.add_argument("--resume", type=Path, default=None, help="run dir, train dir or last.pt of an interrupted run; reuses its saved config.yaml and run folder")
    p.add_argument("--project", type=Path, default=DEFAULT_PROJECT, help="parent folder of run dirs")
    p.add_argument("--name", default=None, help="run folder name (default run_YYYYMMDD_HHMM)")
    p.add_argument("--class-check", choices=("strict", "off"), default="strict", help="require data.yaml names to equal ml/classes.yaml tier A or B")
    p.add_argument("--install-weights", action="store_true", help=f"also copy best.pt to {WEIGHTS_DST.relative_to(REPO_ROOT)}")
    p.add_argument("--notes", default="")
    p.add_argument("--dry-run", action="store_true", help="print the resolved plan as JSON and exit without importing torch/ultralytics")
    return p


def main(argv: Sequence[str] | None = None) -> int:
    """
    CLI entry point.

    Args:
        argv: Argument list (defaults to sys.argv[1:]).
    Returns:
        Process exit code (0 on success, 2 on invalid configuration).
    """
    args = build_parser().parse_args(argv)
    try:
        cfg = resolve_config(args)
    except (ValueError, FileNotFoundError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    if args.dry_run:
        print(json.dumps(describe_plan(cfg), indent=2))
        return 0
    try:
        train(cfg)
    except (ValueError, FileNotFoundError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
