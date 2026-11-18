"""
Module: train_kaggle.py
Purpose: Single-file Kaggle entry point for the DigiSim detector training (twin of ml/train.py, kept
         self-contained so it can be pasted into / uploaded as a Kaggle notebook script without the repo).
         It installs ultralytics, finds the dataset under /kaggle/input, trains on every visible GPU
         (DDP) or the CPU, then writes best.pt, best.onnx, metrics.json (and config.yaml) to
         /kaggle/working/digisim_run. Run it as a script (`!python train_kaggle.py ...`), not via %run,
         because ultralytics DDP re-launches the trainer in child processes.

Usage (notebook cell, GPU T4 x2 / L4 x4 accelerator, internet on for the pip install and COCO weights):
    !python train_kaggle.py --preset stage-a                               # auto-detects /kaggle/input/**/data.yaml
    !python train_kaggle.py --preset stage-a --device 0,1,2,3 --epochs 100
    !python train_kaggle.py --preset stage-b --model /kaggle/input/stage-a/best.pt --real-train images/real
    !python train_kaggle.py --preset stage-a --dry-run                     # print the plan, install/train nothing

The dataset's data.yaml must come from `cd ml && uv run python class_schema.py data-yaml --path DIR` so class ids match
ml/classes.yaml. Kaggle input is read-only: the script rewrites the yaml into the output folder (absolute `path:`) and
ultralytics keeps its label cache in memory when it cannot write next to the labels.
Keep the PRESETS table in sync with ml/train.py (ml/tests/test_train_harness.py asserts it).
"""

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

KAGGLE_INPUT = Path("/kaggle/input")
KAGGLE_WORKING = Path("/kaggle/working")
IMAGE_SUFFIXES = frozenset({".jpg", ".jpeg", ".png", ".bmp", ".webp"})
DATA_YAML_NAMES = ("data.yaml", "dataset.yaml")
F1_THRESHOLD = 0.95
ACC_THRESHOLD = 0.95
METRICS_SCHEMA_VERSION = 1
ONNX_OPSET = 17
SEED = 0
REQUIREMENTS = ("ultralytics>=8.3", "onnx", "onnxslim", "onnxruntime", "pyyaml")


@dataclass(frozen=True)
class Preset:
    """Default hyper-parameters of one training stage (mirror of ml/train.py)."""

    name: str
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


PRESETS: dict[str, Preset] = {
    "smoke": Preset("smoke", "yolov8n.pt", 320, 2, 8, 2, 0.01, 0.01, 0.0, 0, 1, False),
    "stage-a": Preset("stage-a", "yolov8s.pt", 960, 100, 16, 20, 0.01, 0.01, 3.0, 10, 1, True),
    "stage-b": Preset("stage-b", None, 960, 40, 16, 15, 0.002, 0.1, 1.0, 5, 4, True),
}


def default_workers() -> int:
    """
    Default dataloader worker count derived from the CPUs this process may use.

    Returns:
        A value in [1, 8].
    """
    try:
        cpus = len(os.sched_getaffinity(0))
    except AttributeError:
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


def parse_device(spec: str, cuda_count: int | None = None) -> tuple[int, ...]:
    """
    Parse a --device value into CUDA indices (pure string handling, so it works on a machine without a GPU).

    Args:
        spec: 'cpu', 'auto' (all visible GPUs, else CPU), '0', or a comma list like '0,1,2,3'.
        cuda_count: Visible GPU count used by 'auto'; detected via torch when None.
    Returns:
        Device indices; an empty tuple means the CPU.
    Raises:
        ValueError: If the spec is malformed, negative or lists a device twice.
    """
    text = spec.strip().lower().replace(" ", "")
    if text == "cpu":
        return ()
    if text == "auto":
        return tuple(range(detect_cuda_count() if cuda_count is None else cuda_count))
    try:
        ids = tuple(int(p.removeprefix("cuda:")) for p in text.split(",") if p != "")
    except ValueError as exc:
        raise ValueError(f"Bad --device {spec!r}: use 'cpu', 'auto', '0' or '0,1,2,3'") from exc
    if not ids or any(i < 0 for i in ids) or len(set(ids)) != len(ids):
        raise ValueError(f"Bad --device {spec!r}: need unique non-negative device indices")
    return ids


def device_spec(ids: Sequence[int]) -> str:
    """
    Format device indices for ultralytics.

    Args:
        ids: Device indices (empty for CPU).
    Returns:
        'cpu' or '0,1,2,3'.
    """
    return ",".join(str(i) for i in ids) if ids else "cpu"


def resolve_batch(requested: int | None, per_device: int, world_size: int) -> int:
    """
    Resolve the total batch size (ultralytics splits it evenly across DDP processes).

    Args:
        requested: Total batch from --batch, or None for per-device default x world size.
        per_device: Preset batch per device.
        world_size: Number of GPU processes (1 for CPU).
    Returns:
        The total batch size.
    Raises:
        ValueError: If the batch is not positive or not divisible by the GPU count.
    """
    batch = per_device * world_size if requested is None else requested
    if batch == -1 and world_size == 1:
        return batch
    if batch < 1:
        raise ValueError(f"batch must be >= 1 (got {batch}); -1 auto-batch is single-device only")
    if batch % world_size:
        raise ValueError(f"batch {batch} must be a multiple of the GPU count {world_size} for DDP")
    return batch


def find_data_yaml(root: Path = KAGGLE_INPUT, hint: str = "") -> Path:
    """
    Locate the dataset yaml under the Kaggle input folder (searches up to 4 levels deep).

    Args:
        root: Folder to search (default /kaggle/input).
        hint: Optional substring that must appear in the yaml's path to disambiguate several datasets.
    Returns:
        The single matching data.yaml.
    Raises:
        FileNotFoundError: If none is found.
        ValueError: If several match (pass --data or --dataset-hint).
    """
    candidates: list[Path] = []
    if root.is_dir():
        for name in DATA_YAML_NAMES:
            for depth in range(4):
                candidates += root.glob("/".join(["*"] * depth + [name]))
    found = sorted({p for p in candidates if hint in str(p)})
    if not found:
        raise FileNotFoundError(f"No data.yaml under {root}" + (f" matching {hint!r}" if hint else "") + " - attach the dataset to the notebook or pass --data")
    if len(found) > 1:
        raise ValueError("Several datasets found, pass --data or --dataset-hint: " + ", ".join(str(p) for p in found))
    return found[0]


def read_yaml(path: Path) -> dict[str, Any]:
    """
    Parse a YAML file into a mapping.

    Args:
        path: YAML file.
    Returns:
        The parsed mapping.
    Raises:
        ValueError: If the file is not a mapping.
    """
    import yaml

    cfg = yaml.safe_load(path.read_text())
    if not isinstance(cfg, dict):
        raise ValueError(f"{path}: expected a YAML mapping")
    return cfg


def list_images(entries: Iterable[Path]) -> list[Path]:
    """
    Expand image files, image directories and .txt lists into a sorted, de-duplicated image list.

    Args:
        entries: Image files, directories (recursive) or .txt lists (one path per line).
    Returns:
        Absolute image paths, sorted.
    """
    found: set[Path] = set()
    for entry in entries:
        if entry.is_dir():
            found.update(p.resolve() for p in entry.rglob("*") if p.suffix.lower() in IMAGE_SUFFIXES)
        elif entry.suffix == ".txt" and entry.is_file():
            for line in entry.read_text().splitlines():
                if line.strip():
                    p = Path(line.strip())
                    found.add((p if p.is_absolute() else entry.parent / p).resolve())
        elif entry.suffix.lower() in IMAGE_SUFFIXES and entry.is_file():
            found.add(entry.resolve())
    return sorted(found)


def split_images(cfg: dict[str, Any], root: Path, split: str) -> list[Path]:
    """
    Images of one split of a dataset yaml (empty when the split is not declared).

    Args:
        cfg: Parsed data.yaml.
        root: Dataset root that the split entries are relative to.
        split: 'train', 'val' or 'test'.
    Returns:
        Sorted absolute image paths.
    """
    value = cfg.get(split)
    if not value:
        return []
    return list_images(root / str(item) for item in (value if isinstance(value, list) else [value]))


def prepare_data_yaml(data_yaml: Path, out_dir: Path, real_train: Sequence[Path], oversample: int) -> tuple[Path, dict[str, int]]:
    """
    Write a data yaml that points at the (read-only) dataset by absolute path, optionally oversampling real images.

    Args:
        data_yaml: The dataset yaml found under /kaggle/input.
        out_dir: Writable folder for the rewritten yaml and train list.
        real_train: Real training image folders/lists (relative paths resolve against the dataset folder).
        oversample: Times each real image repeats per epoch (1 = off).
    Returns:
        (path of the yaml to train on, split image counts).
    Raises:
        ValueError: If the yaml lacks train/val/names, no real image is found, or real images leak into val/test.
    """
    cfg = read_yaml(data_yaml)
    if not {"train", "val", "names"} <= cfg.keys() or not cfg["names"]:
        raise ValueError(f"{data_yaml}: expected a YOLO data.yaml with train, val and a non-empty names")
    # The dataset travels between machines, so ignore any absolute `path:` written at generation time.
    root = data_yaml.parent
    counts = {split: len(split_images(cfg, root, split)) for split in ("train", "val", "test")}
    out_cfg = {**cfg, "path": str(root.resolve())}
    out_dir.mkdir(parents=True, exist_ok=True)
    if real_train:
        real = list_images(p if p.is_absolute() else root / p for p in real_train)
        if not real:
            raise ValueError(f"No images found under --real-train {[str(p) for p in real_train]}")
        held_out = set(split_images(cfg, root, "val")) | set(split_images(cfg, root, "test"))
        if held_out & set(real):
            raise ValueError("Real training images overlap the val/test split (leakage)")
        real_set = set(real)
        lines = [str(p) for p in split_images(cfg, root, "train") if p not in real_set] + [str(p) for p in real for _ in range(oversample)]
        (out_dir / "train_mixed.txt").write_text("\n".join(lines) + "\n")
        out_cfg["train"] = str(out_dir / "train_mixed.txt")
        counts["train"] = len(lines)
    import yaml

    out_yaml = out_dir / "data.yaml"
    out_yaml.write_text(yaml.safe_dump(out_cfg, sort_keys=False))
    return out_yaml, counts


def per_class_metrics(box: Any, names: dict[int, str], confusion: Any, instances: Any) -> dict[str, dict[str, float]]:
    """
    Per-class precision/recall/F1/AP/accuracy from an ultralytics validation result (same as ml/train.py).

    Args:
        box: The `metrics.box` object (duck-typed ultralytics result).
        names: Class id to name map of the model.
        confusion: The validator confusion matrix (matrix[pred, gt]) or None.
        instances: Per-class ground-truth counts or None.
    Returns:
        Class name to metric dict; accuracy = confusion TP / all ground truth of the class.
    """
    import numpy as np

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


def gate_verdict(per_class: dict[str, dict[str, float]]) -> dict[str, Any]:
    """
    Apply the phase gate (F1 >= 0.95 and accuracy >= 0.95 per class).

    Args:
        per_class: Output of per_class_metrics().
    Returns:
        Thresholds, failing class names and the overall pass flag (False when nothing was evaluated).
    """
    failing = [n for n, m in per_class.items() if m.get("f1", 0.0) < F1_THRESHOLD or m.get("accuracy", 0.0) < ACC_THRESHOLD]
    return {"f1_threshold": F1_THRESHOLD, "accuracy_threshold": ACC_THRESHOLD, "failing_classes": failing, "passed": bool(per_class) and not failing}


def install_requirements(requirements: Sequence[str] = REQUIREMENTS) -> None:
    """
    Pip-install the training dependencies (Kaggle already ships torch; this adds ultralytics and the ONNX toolchain).

    Args:
        requirements: pip requirement specifiers.
    Raises:
        subprocess.CalledProcessError: If pip fails (typically the notebook's internet toggle is off).
    """
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", *requirements], check=True)


def environment_info() -> dict[str, Any]:
    """
    Describe the software and hardware the run executed on.

    Returns:
        Versions, CPU count and GPU names (None / empty when not importable).
    """
    info: dict[str, Any] = {"python": platform.python_version(), "platform": platform.platform(), "cpu_count": os.cpu_count(), "torch": None, "ultralytics": None, "cuda_devices": []}
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


def build_plan(args: argparse.Namespace) -> dict[str, Any]:
    """
    Resolve preset defaults and CLI overrides into one settings dict (no side effects beyond path discovery).

    Args:
        args: Parsed CLI arguments.
    Returns:
        Settings: preset, model, device ids/spec, world size, batch, workers, epochs, imgsz, data yaml (or None plus a warning), run dir.
    Raises:
        ValueError: If the device, batch, stage-B model or oversample settings are invalid.
        FileNotFoundError: If --resume points at nothing.
    """
    ids = parse_device(args.device)
    world = max(1, len(ids))
    resume = resolve_resume_checkpoint(args.resume) if args.resume else None
    out_dir = resume.parent.parent.parent if resume else args.out
    saved = read_yaml(out_dir / "config.yaml") if resume and (out_dir / "config.yaml").is_file() else {}
    preset = PRESETS[args.preset or str(saved.get("preset") or "stage-a")]
    model = str(saved.get("model") or resume) if resume else (args.model or preset.model)  # a resumed run keeps its original base weights on record
    if model is None:
        raise ValueError(f"preset {preset.name} fine-tunes earlier weights: pass --model /kaggle/input/<stage-a>/best.pt")
    saved_real = saved.get("real_train") or []
    real_train = [Path(str(p)) for p in (args.real_train or saved_real)]
    inherited = not args.real_train and bool(saved_real)
    default_oversample = int(saved.get("real_oversample") or 1) if inherited else (preset.real_oversample if real_train else 1)
    oversample = args.real_oversample if args.real_oversample is not None else default_oversample
    saved_batch = int(str(saved["batch_total"])) if resume and saved.get("batch_total") else None  # resume keeps the original total batch unless --batch says otherwise
    if oversample > 1 and not real_train:
        raise ValueError("--real-oversample needs at least one --real-train folder")
    warnings: list[str] = []
    data_yaml: Path | None = None
    try:
        data_yaml = args.data or (Path(saved["data_yaml"]) if saved.get("data_yaml") else find_data_yaml(args.input_root, args.dataset_hint))
        if not data_yaml.is_file():
            raise FileNotFoundError(f"{data_yaml} not found")
    except (FileNotFoundError, ValueError) as exc:
        warnings.append(f"dataset: {exc}")
        data_yaml = None
    return {
        "preset": preset.name,
        "model": model,
        "resume": str(resume) if resume else None,
        "device_ids": list(ids),
        "device": device_spec(ids),
        "world_size": world,
        "ddp": world > 1,
        "batch_total": resolve_batch(args.batch if args.batch is not None else saved_batch, preset.batch_per_device, world),
        "workers": args.workers if args.workers is not None else default_workers(),
        "epochs": args.epochs if args.epochs is not None else int(saved.get("epochs") or preset.epochs),
        "time_hours": args.time if args.time is not None else (float(saved["time_hours"]) if saved.get("time_hours") else None),
        "imgsz": args.imgsz if args.imgsz is not None else int(saved.get("imgsz") or preset.imgsz),
        "patience": args.patience if args.patience is not None else int(saved.get("patience") or preset.patience),
        "lr0": args.lr0 if args.lr0 is not None else float(saved.get("lr0") or preset.lr0),
        "lrf": preset.lrf,
        "warmup_epochs": preset.warmup_epochs,
        "close_mosaic": preset.close_mosaic,
        "plots": preset.plots if args.plots is None else args.plots,
        "seed": args.seed if args.seed is not None else int(saved.get("seed") or SEED),
        "real_train": [str(p) for p in real_train],
        "real_oversample": oversample,
        "data_yaml": str(data_yaml) if data_yaml else None,
        "out_dir": str(out_dir),
        "warnings": warnings,
    }


def run(plan: dict[str, Any], install: bool) -> Path:
    """
    Execute the plan: install deps, train (DDP on every listed GPU), validate best.pt, export ONNX, write metrics.json.

    Args:
        plan: Output of build_plan() with a resolvable data_yaml.
        install: Whether to pip-install the requirements first.
    Returns:
        The output directory with best.pt, best.onnx, metrics.json and config.yaml.
    Raises:
        FileNotFoundError: If no dataset yaml was found.
    """
    if not plan["data_yaml"]:
        raise FileNotFoundError("; ".join(plan["warnings"]) or "no dataset")
    if install:
        install_requirements()
    import yaml
    from ultralytics import YOLO

    out = Path(plan["out_dir"])
    out.mkdir(parents=True, exist_ok=True)
    data_yaml, counts = prepare_data_yaml(Path(plan["data_yaml"]), out, [Path(p) for p in plan["real_train"]], plan["real_oversample"])
    data_cfg = read_yaml(data_yaml)
    (out / "config.yaml").write_text(yaml.safe_dump({**plan, "data_effective": str(data_yaml)}, sort_keys=False))

    started = time.time()
    model = YOLO(plan["resume"] or plan["model"])  # always a pretrained checkpoint: transfer learning only
    if plan["resume"]:
        # `data` is only ultralytics' fallback when the checkpoint's recorded dataset yaml is gone (copied run dir); without it a
        # resume silently falls back to coco8 instead of the mixed, oversampled dataset.
        model.train(resume=True, data=str(data_yaml), device=plan["device"], batch=plan["batch_total"], imgsz=plan["imgsz"], workers=plan["workers"])
    else:
        model.train(
            data=str(data_yaml),
            epochs=plan["epochs"],
            imgsz=plan["imgsz"],
            batch=plan["batch_total"],
            device=plan["device"],
            workers=plan["workers"],
            patience=plan["patience"],
            seed=plan["seed"],
            lr0=plan["lr0"],
            lrf=plan["lrf"],
            warmup_epochs=plan["warmup_epochs"],
            close_mosaic=plan["close_mosaic"],
            plots=plan["plots"],
            **({"time": plan["time_hours"]} if plan["time_hours"] else {}),
            project=str(out),
            name="train",
            exist_ok=True,
        )
    best = Path(model.trainer.best) if Path(model.trainer.best).is_file() else Path(model.trainer.last)

    split = "test" if data_cfg.get("test") else "val"
    eval_device = "cpu" if not plan["device_ids"] else str(plan["device_ids"][0])  # single-process validation even after DDP
    best_model = YOLO(str(best))
    val = best_model.val(data=str(data_yaml), split=split, imgsz=plan["imgsz"], batch=16, device=eval_device, workers=0, plots=True, project=str(out), name="val", exist_ok=True)
    per_class = per_class_metrics(val.box, best_model.names, getattr(val, "confusion_matrix", None), getattr(val, "nt_per_class", None))
    onnx_src = Path(best_model.export(format="onnx", imgsz=plan["imgsz"], opset=ONNX_OPSET, simplify=True, dynamic=False, device="cpu"))
    shutil.copy2(best, out / "best.pt")
    shutil.copy2(onnx_src, out / "best.onnx")

    summary = {
        "schema_version": METRICS_SCHEMA_VERSION,
        "run_name": out.name,
        "preset": plan["preset"],
        "resumed_from": plan["resume"],
        "map50": float(val.box.map50),
        "map50_95": float(val.box.map),
        "mean_precision": float(val.box.mp),
        "mean_recall": float(val.box.mr),
        "eval_split": split,
        "per_class": per_class,
        "gate": gate_verdict(per_class),
        "class_names": [best_model.names[i] for i in sorted(best_model.names)],
        "dataset": {"data": plan["data_yaml"], "data_effective": str(data_yaml), **{f"{k}_images": v for k, v in counts.items()}, "real_oversample": plan["real_oversample"]},
        "settings": {k: plan[k] for k in ("model", "epochs", "time_hours", "imgsz", "device", "workers", "seed", "lr0")} | {"batch": plan["batch_total"]},
        "environment": environment_info(),
        "train_seconds": round(time.time() - started, 1),
        "weights": str(out / "best.pt"),
        "onnx": str(out / "best.onnx"),
    }
    (out / "metrics.json").write_text(json.dumps(summary, indent=2))
    print(f"\nWrote {out}/best.pt, best.onnx, metrics.json")
    return out


def build_parser() -> argparse.ArgumentParser:
    """
    Build the CLI parser (all tunables default to None so presets can fill them in).

    Returns:
        The configured parser.
    """
    p = argparse.ArgumentParser(description="Kaggle training entry point for the DigiSim detector")
    p.add_argument(
        "--preset", choices=sorted(PRESETS), default=None, help="default stage-a (or the resumed run's preset). stage-a: synthetic pretrain | stage-b: mixed fine-tune | smoke: 2-epoch check"
    )
    p.add_argument("--data", type=Path, default=None, help="data.yaml (default: discovered under --input-root)")
    p.add_argument("--input-root", type=Path, default=KAGGLE_INPUT)
    p.add_argument("--dataset-hint", default="", help="substring that disambiguates several attached datasets")
    p.add_argument("--model", default=None, help="pretrained .pt to start from (stage-b: the stage-A best.pt)")
    p.add_argument("--device", default="auto", help="auto (all visible GPUs, else CPU) | cpu | 0 | 0,1,2,3")
    p.add_argument("--epochs", type=int, default=None)
    p.add_argument("--time", type=float, default=None, help="wall-clock training budget in hours; overrides --epochs (ultralytics fits the epoch count and LR schedule to it)")
    p.add_argument("--imgsz", type=int, default=None)
    p.add_argument("--batch", type=int, default=None, help="TOTAL batch across GPUs (default: per-device preset x GPUs)")
    p.add_argument("--workers", type=int, default=None)
    p.add_argument("--patience", type=int, default=None)
    p.add_argument("--lr0", type=float, default=None)
    p.add_argument("--seed", type=int, default=None, help=f"default {SEED} (or the resumed run's seed)")
    p.add_argument("--plots", action=argparse.BooleanOptionalAction, default=None)
    p.add_argument("--real-train", action="append", default=[], help="real training image folder/list, relative to the dataset folder (repeatable)")
    p.add_argument("--real-oversample", type=int, default=None, help="times each real image repeats per epoch (stage-b default 4)")
    p.add_argument("--resume", type=Path, default=None, help="run dir, train dir or last.pt of an interrupted run; reuses its saved config.yaml and folder")
    p.add_argument("--out", type=Path, default=KAGGLE_WORKING / "digisim_run")
    p.add_argument("--skip-install", action="store_true", help="do not pip install ultralytics/onnx")
    p.add_argument("--dry-run", action="store_true", help="print the resolved plan as JSON and exit; installs and trains nothing")
    return p


def strip_kernel_args(argv: Sequence[str]) -> list[str]:
    """
    Drop the `-f <connection file>` pair a Jupyter kernel injects into sys.argv; every other argument is kept.

    Args:
        argv: Raw argument list.
    Returns:
        The list without `-f` and its value.
    """
    kept: list[str] = []
    skip = False
    for arg in argv:
        if skip:
            skip = False
        elif arg == "-f":
            skip = True
        elif not arg.startswith("-f="):
            kept.append(arg)
    return kept


def main(argv: Sequence[str] | None = None) -> int:
    """
    CLI entry point (rejects unknown arguments, except the Jupyter kernel's `-f connection.json`).

    Args:
        argv: Argument list (defaults to sys.argv[1:]).
    Returns:
        Process exit code (0 on success, 2 on invalid configuration or missing dataset).
    """
    args = build_parser().parse_args(strip_kernel_args(sys.argv[1:] if argv is None else argv))
    try:
        plan = build_plan(args)
        if args.dry_run:
            print(json.dumps(plan, indent=2))
            return 0
        run(plan, install=not args.skip_install)
    except (ValueError, FileNotFoundError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
