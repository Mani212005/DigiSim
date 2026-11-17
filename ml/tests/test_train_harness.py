"""
Module: test_train_harness.py
Purpose: Tests for the training harness (ml/train.py) and its single-file Kaggle twin
         (ml/kaggle/train_kaggle.py): device parsing for cpu/0/0,1,2,3, dry-run plans, batch and
         workers defaults, preset parity between the two scripts, real-image oversampling,
         resume lookup, metrics assembly, and an opt-in end-to-end CPU smoke run
         (DIGISIM_ML_SMOKE=1) that must produce metrics.json and an ONNX file.
"""

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import numpy as np
import pytest
import yaml

import make_smoke_dataset
import train

ML_DIR = Path(__file__).resolve().parents[1]
KAGGLE_PATH = ML_DIR / "kaggle" / "train_kaggle.py"


def load_kaggle() -> ModuleType:
    """
    Import ml/kaggle/train_kaggle.py by path (it is deliberately not a package module).

    Returns:
        The loaded module.
    """
    spec = importlib.util.spec_from_file_location("train_kaggle", KAGGLE_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["train_kaggle"] = module
    spec.loader.exec_module(module)
    return module


train_kaggle = load_kaggle()


@pytest.fixture(scope="module")
def smoke_data(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """
    A 24-image throwaway dataset shared by the module.

    Args:
        tmp_path_factory: pytest temp factory.
    Returns:
        Path to its data.yaml.
    """
    return make_smoke_dataset.generate(tmp_path_factory.mktemp("smoke"), 24, seed=3)


def parse(argv: list[str]) -> train.TrainConfig:
    """
    Run the real CLI parser and resolver on an argv list.

    Args:
        argv: Command-line arguments.
    Returns:
        The resolved config.
    """
    return train.resolve_config(train.build_parser().parse_args(argv))


@pytest.mark.parametrize(
    ("spec", "ids", "world", "text"),
    [("cpu", (), 1, "cpu"), ("0", (0,), 1, "0"), ("0,1,2,3", (0, 1, 2, 3), 4, "0,1,2,3"), (" 0, 1 ", (0, 1), 2, "0,1"), ("cuda:1", (1,), 1, "1")],
)
def test_parse_device(spec: str, ids: tuple[int, ...], world: int, text: str) -> None:
    """
    parse_device accepts cpu / single GPU / GPU lists without any GPU present and both scripts agree.

    Args:
        spec: Device string.
        ids: Expected indices.
        world: Expected DDP world size.
        text: Expected ultralytics device string.
    """
    plan = train.parse_device(spec)
    assert plan.ids == ids and plan.world_size == world and plan.spec == text
    assert train_kaggle.parse_device(spec) == ids and train_kaggle.device_spec(ids) == text


@pytest.mark.parametrize("bad", ["", "gpu", "0,0", "-1", "0,,x"])
def test_parse_device_rejects_garbage(bad: str) -> None:
    """
    Malformed device strings fail loudly in both scripts.

    Args:
        bad: Invalid device string.
    """
    with pytest.raises(ValueError):
        train.parse_device(bad)
    with pytest.raises(ValueError):
        train_kaggle.parse_device(bad)


def test_auto_device_uses_visible_gpu_count() -> None:
    """auto resolves to every visible GPU, or the CPU when there is none."""
    assert train.parse_device("auto", cuda_count=0).is_cpu
    assert train.parse_device("auto", cuda_count=4).ids == (0, 1, 2, 3)
    assert train_kaggle.parse_device("auto", cuda_count=2) == (0, 1)


def test_batch_defaults_scale_with_gpus_and_must_divide() -> None:
    """The default batch is per-device x GPUs; an explicit batch must split evenly across DDP processes."""
    assert parse(["--preset", "stage-a", "--device", "0,1,2,3"]).batch == 64
    assert parse(["--preset", "stage-a", "--device", "cpu"]).batch == 16
    with pytest.raises(ValueError, match="multiple"):
        parse(["--device", "0,1,2", "--batch", "16"])
    with pytest.raises(ValueError, match="batch must be"):
        parse(["--device", "0,1", "--batch", "-1"])
    assert parse(["--device", "0", "--batch", "-1"]).batch == -1


def test_workers_default_follows_cpu_count(monkeypatch: pytest.MonkeyPatch) -> None:
    """--workers defaults from the CPUs this process may use (capped at 8), never a constant."""
    monkeypatch.setattr(os, "sched_getaffinity", lambda _pid: set(range(3)), raising=False)
    assert train.default_workers() == 3 and train_kaggle.default_workers() == 3
    monkeypatch.setattr(os, "sched_getaffinity", lambda _pid: set(range(64)), raising=False)
    assert train.default_workers() == 8
    assert parse(["--workers", "2"]).workers == 2


class FakeYOLO:
    """Stand-in for ultralytics.YOLO that records every train/val/export call and writes the artifacts they would."""

    calls: list[tuple[str, dict[str, object]]] = []
    root: Path = Path()

    def __init__(self, weights: str) -> None:
        """
        Remember the weights and expose the attributes the harness reads.

        Args:
            weights: Checkpoint path or name the harness asked for.
        """
        self.weights = weights
        self.names = {0: "NMOS"}
        self.trainer = SimpleNamespace(best=str(self.root / "best.pt"), last=str(self.root / "last.pt"), save_dir=str(self.root))

    def train(self, **kwargs: object) -> None:
        """
        Record a training call.

        Args:
            **kwargs: Arguments the harness passed to ultralytics.
        """
        type(self).calls.append(("train", kwargs))

    def val(self, **kwargs: object) -> SimpleNamespace:
        """
        Record a validation call and return an empty-but-valid metrics object.

        Args:
            **kwargs: Arguments the harness passed to ultralytics.
        Returns:
            A result with the attributes the harness reads.
        """
        type(self).calls.append(("val", kwargs))
        box = SimpleNamespace(map50=0.5, map=0.4, mp=0.6, mr=0.7, ap_class_index=np.array([], dtype=int))
        return SimpleNamespace(box=box, confusion_matrix=None, nt_per_class=None)

    def export(self, **kwargs: object) -> str:
        """
        Record an export call and write a placeholder ONNX file.

        Args:
            **kwargs: Arguments the harness passed to ultralytics.
        Returns:
            Path of the placeholder file.
        """
        type(self).calls.append(("export", kwargs))
        onnx = self.root / "model.onnx"
        onnx.write_bytes(b"onnx")
        return str(onnx)


@pytest.fixture
def fake_yolo(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> type[FakeYOLO]:
    """
    Replace the ultralytics package with FakeYOLO so train()/run() execute for real without training.

    Args:
        monkeypatch: pytest monkeypatch.
        tmp_path: Per-test temp dir that holds the fake checkpoints.
    Returns:
        The FakeYOLO class (its `calls` list is fresh for each test).
    """
    root = tmp_path / "fake_ultralytics"
    root.mkdir()
    for name in ("best.pt", "last.pt"):
        (root / name).write_bytes(b"pt")
    FakeYOLO.calls = []
    FakeYOLO.root = root
    module = ModuleType("ultralytics")
    module.YOLO = FakeYOLO  # type: ignore[attr-defined]
    module.__version__ = "0.0-test"  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "ultralytics", module)
    return FakeYOLO


def kinds(fake: type[FakeYOLO], kind: str) -> list[dict[str, object]]:
    """
    Arguments of every recorded call of one kind.

    Args:
        fake: The FakeYOLO class.
        kind: 'train', 'val' or 'export'.
    Returns:
        The keyword-argument dicts, in call order.
    """
    return [kw for k, kw in fake.calls if k == kind]


@pytest.mark.parametrize(("device", "val_device"), [("cpu", "cpu"), ("0", "0"), ("0,1,2,3", "0")])
def test_device_reaches_ultralytics_and_export_stays_on_cpu(device: str, val_device: str, fake_yolo: type[FakeYOLO], smoke_data: Path, tmp_path: Path) -> None:
    """Both scripts hand --device to training, validate single-process on the first GPU, and always export on the CPU."""
    cfg = parse(["--preset", "smoke", "--data", str(smoke_data), "--device", device, "--project", str(tmp_path / "runs"), "--name", "a"])
    run_dir = train.train(cfg)
    plan = train_kaggle.build_plan(train_kaggle.build_parser().parse_args(["--preset", "smoke", "--data", str(smoke_data), "--device", device, "--out", str(tmp_path / "kaggle")]))
    kaggle_dir = train_kaggle.run(plan, install=False)
    for out in (run_dir, kaggle_dir):
        assert (out / "metrics.json").is_file() and (out / "best.onnx").is_file()
    trains, vals, exports = kinds(fake_yolo, "train"), kinds(fake_yolo, "val"), kinds(fake_yolo, "export")
    assert [kw["device"] for kw in trains] == [device, device]
    assert [kw["device"] for kw in vals] == [val_device, val_device]
    assert [kw["device"] for kw in exports] == ["cpu", "cpu"] and all(kw["format"] == "onnx" for kw in exports)


def write_resumable_stage_b_run(run_dir: Path, real_dir: Path, data: Path) -> None:
    """
    Lay out an interrupted stage-B run: a last.pt checkpoint plus the config.yaml both scripts write.

    Args:
        run_dir: The run folder to create.
        real_dir: The real-image folder that was oversampled.
        data: The dataset yaml the run trained on.
    """
    last = run_dir / "train" / "weights" / "last.pt"
    last.parent.mkdir(parents=True)
    last.write_bytes(b"pt")
    saved = {"preset": "stage-b", "data": str(data), "data_yaml": str(data), "imgsz": 320, "epochs": 9, "patience": 7, "lr0": 0.003, "seed": 5, "real_train": [str(real_dir)], "real_oversample": 4}
    (run_dir / "config.yaml").write_text(yaml.safe_dump(saved))


@pytest.fixture
def real_images(tmp_path: Path) -> Path:
    """
    Three throwaway real-image files outside the dataset.

    Args:
        tmp_path: Per-test temp dir.
    Returns:
        The folder holding them.
    """
    real_dir = tmp_path / "real"
    real_dir.mkdir()
    for i in range(3):
        (real_dir / f"real_{i}.jpg").write_bytes(b"x")
    return real_dir


def test_resume_keeps_real_oversampling(fake_yolo: type[FakeYOLO], smoke_data: Path, real_images: Path, tmp_path: Path) -> None:
    """Resuming a stage-B run restores real_train, oversample, patience, lr0 and seed instead of silently dropping the mix."""
    run_dir = tmp_path / "runs" / "b"
    write_resumable_stage_b_run(run_dir, real_images, smoke_data)
    cfg = parse(["--resume", str(run_dir), "--device", "cpu"])
    assert cfg.real_train == (real_images,) and cfg.real_oversample == 4
    assert (cfg.patience, cfg.lr0, cfg.seed) == (7, 0.003, 5)
    overridden = parse(["--resume", str(run_dir), "--device", "cpu", "--real-train", str(tmp_path), "--real-oversample", "2", "--seed", "0"])
    assert overridden.real_train == (tmp_path,) and overridden.real_oversample == 2 and overridden.seed == 0
    train.train(cfg)
    assert kinds(fake_yolo, "train")[0]["resume"] is True
    lines = (run_dir / "train_mixed.txt").read_text().split()
    assert lines.count(str((real_images / "real_0.jpg").resolve())) == 4
    saved = yaml.safe_load((run_dir / "config.yaml").read_text())
    assert saved["real_train"] == [str(real_images)] and saved["real_oversample"] == 4
    assert json.loads((run_dir / "metrics.json").read_text())["dataset"]["real_oversample"] == 4


def test_kaggle_resume_keeps_real_oversampling(fake_yolo: type[FakeYOLO], smoke_data: Path, real_images: Path, tmp_path: Path) -> None:
    """The Kaggle twin restores the saved mix on --resume and never rewrites data.yaml without the oversampled train list."""
    out = tmp_path / "kaggle"
    write_resumable_stage_b_run(out, real_images, smoke_data)
    plan = train_kaggle.build_plan(train_kaggle.build_parser().parse_args(["--resume", str(out), "--device", "cpu"]))
    assert plan["real_train"] == [str(real_images)] and plan["real_oversample"] == 4
    assert (plan["epochs"], plan["patience"], plan["lr0"], plan["seed"]) == (9, 7, 0.003, 5)
    train_kaggle.run(plan, install=False)
    assert kinds(fake_yolo, "train")[0]["resume"] is True
    assert train_kaggle.read_yaml(out / "data.yaml")["train"] == str(out / "train_mixed.txt")
    assert (out / "train_mixed.txt").read_text().split().count(str((real_images / "real_0.jpg").resolve())) == 4
    saved = yaml.safe_load((out / "config.yaml").read_text())
    assert saved["real_oversample"] == 4 and saved["real_train"] == [str(real_images)]
    assert json.loads((out / "metrics.json").read_text())["dataset"]["real_oversample"] == 4


def test_kaggle_cli_ignores_only_the_jupyter_kernel_arguments(smoke_data: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """`-f kernel.json` is dropped, but a mistyped option fails loudly instead of silently starting the wrong run."""
    assert train_kaggle.strip_kernel_args(["--device", "cpu", "-f", "/tmp/kernel.json", "--dry-run"]) == ["--device", "cpu", "--dry-run"]
    assert train_kaggle.main(["--data", str(smoke_data), "--device", "cpu", "-f", "/tmp/kernel.json", "--dry-run"]) == 0
    assert json.loads(capsys.readouterr().out)["device"] == "cpu"
    for typo in ("--real_train", "--dataset_hint", "--bogus"):
        with pytest.raises(SystemExit) as exc:
            train_kaggle.main(["--dry-run", typo, "x"])
        assert exc.value.code == 2


def test_presets_match_between_train_and_kaggle() -> None:
    """The Kaggle script duplicates the preset table; every shared hyper-parameter must stay identical."""
    assert train.PRESETS.keys() == train_kaggle.PRESETS.keys()
    for name, preset in train.PRESETS.items():
        twin = train_kaggle.PRESETS[name]
        for field in ("model", "imgsz", "epochs", "batch_per_device", "patience", "lr0", "lrf", "warmup_epochs", "close_mosaic", "real_oversample", "plots"):
            assert getattr(preset, field) == getattr(twin, field), f"{name}.{field} differs"
    assert (train.F1_THRESHOLD, train.ACC_THRESHOLD, train.ONNX_OPSET) == (train_kaggle.F1_THRESHOLD, train_kaggle.ACC_THRESHOLD, train_kaggle.ONNX_OPSET)


def test_stage_b_requires_stage_a_weights() -> None:
    """Stage B fine-tunes earlier weights, so it refuses to guess a base model."""
    with pytest.raises(ValueError, match="--model"):
        parse(["--preset", "stage-b"])
    cfg = parse(["--preset", "stage-b", "--model", "a.pt", "--real-train", "/x"])
    assert cfg.model == "a.pt" and cfg.real_oversample == 4 and cfg.lr0 == 0.002
    with pytest.raises(ValueError, match="--real-train"):
        parse(["--preset", "stage-a", "--real-oversample", "3"])


@pytest.mark.parametrize("device", ["cpu", "0", "0,1,2,3"])
def test_dry_run_runs_unchanged_for_any_device(device: str, smoke_data: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """The same command succeeds for cpu, 0 and 0,1,2,3 in --dry-run (no GPU, no torch, no training)."""
    code = train.main(["--preset", "stage-a", "--data", str(smoke_data), "--device", device, "--dry-run"])
    plan = json.loads(capsys.readouterr().out)
    assert code == 0
    assert plan["device"]["spec"] == device
    assert plan["device"]["ddp"] == (device == "0,1,2,3")
    assert plan["dataset"]["classes"] == 14 and plan["dataset"]["tier"] == "A" and plan["dataset"]["eval_split"] == "test"
    assert plan["batch_total"] % plan["device"]["world_size"] == 0
    assert plan["workers"] >= 1


def test_kaggle_dry_run_for_any_device(smoke_data: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """The Kaggle script dry-runs on a laptop for every device layout and tolerates a missing /kaggle/input."""
    for device in ("cpu", "0", "0,1,2,3"):
        assert train_kaggle.main(["--preset", "stage-a", "--device", device, "--data", str(smoke_data), "--dry-run"]) == 0
        plan = json.loads(capsys.readouterr().out)
        assert plan["device"] == device and plan["batch_total"] == 16 * max(1, len(plan["device_ids"]))
    assert train_kaggle.main(["--dry-run", "--input-root", str(smoke_data.parent / "nowhere")]) == 0
    assert "No data.yaml" in json.loads(capsys.readouterr().out)["warnings"][0]
    assert train_kaggle.main(["--device", "0,1,2", "--batch", "16", "--dry-run"]) == 2


def test_dry_run_flags_class_drift(tmp_path: Path, smoke_data: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """A dataset whose names drift from classes.yaml is reported (dry-run) and refused (strict check)."""
    text = smoke_data.read_text().replace("NMOS", "NFET")
    drifted = tmp_path / "data.yaml"
    drifted.write_text(text)
    assert train.main(["--data", str(drifted), "--device", "cpu", "--dry-run"]) == 0
    assert any("classes.yaml" in w for w in json.loads(capsys.readouterr().out)["warnings"])
    with pytest.raises(ValueError, match="classes.yaml"):
        train.check_class_vocabulary(train.dataset_names(train.load_data_yaml(drifted)))


def test_build_mixed_dataset_oversamples_real_and_blocks_leakage(tmp_path: Path, smoke_data: Path) -> None:
    """Stage-B: each real image appears `factor` times, synthetic ones once, and val/test images are refused."""
    root = smoke_data.parent
    real_dir = tmp_path / "real" / "images" / "train"
    real_dir.mkdir(parents=True)
    for i in range(3):
        (real_dir / f"real_{i}.jpg").write_bytes(b"x")
    out_yaml = train.build_mixed_dataset(smoke_data, [real_dir], 4, tmp_path / "out")
    lines = (tmp_path / "out" / "train_mixed.txt").read_text().split()
    base = train.split_images(train.load_data_yaml(smoke_data), smoke_data, "train")
    assert len(lines) == len(base) + 3 * 4
    assert lines.count(str((real_dir / "real_0.jpg").resolve())) == 4
    derived = train.load_data_yaml(out_yaml)
    assert derived["train"].endswith("train_mixed.txt") and derived["val"] == "images/valid" and Path(derived["path"]) == root.resolve()
    with pytest.raises(ValueError, match="val/test"):
        train.build_mixed_dataset(smoke_data, [root / "images" / "valid"], 2, tmp_path / "leak")
    with pytest.raises(ValueError, match=">= 1"):
        train.build_mixed_dataset(smoke_data, [real_dir], 0, tmp_path / "zero")


def test_kaggle_prepare_data_yaml_rewrites_path_and_oversamples(tmp_path: Path, smoke_data: Path) -> None:
    """The Kaggle script re-roots the yaml at the dataset folder (ignoring a stale absolute path) and oversamples real images."""
    stale = smoke_data.read_text().replace(str(smoke_data.parent.resolve()), "/somewhere/else")
    moved = tmp_path / "input" / "ds"
    moved.mkdir(parents=True)
    (moved / "images").symlink_to(smoke_data.parent / "images")
    (moved / "labels").symlink_to(smoke_data.parent / "labels")
    (moved / "data.yaml").write_text(stale)
    assert train_kaggle.find_data_yaml(tmp_path / "input") == moved / "data.yaml"
    with pytest.raises(FileNotFoundError):
        train_kaggle.find_data_yaml(tmp_path / "input", hint="nomatch")
    out_yaml, counts = train_kaggle.prepare_data_yaml(moved / "data.yaml", tmp_path / "work", [], 1)
    assert train_kaggle.read_yaml(out_yaml)["path"] == str(moved.resolve()) and counts["train"] == 16 and counts["test"] == 4
    out_yaml, counts = train_kaggle.prepare_data_yaml(moved / "data.yaml", tmp_path / "work2", [Path("images/train")], 3)
    assert counts["train"] == 16 * 3
    with pytest.raises(ValueError, match="leakage"):
        train_kaggle.prepare_data_yaml(moved / "data.yaml", tmp_path / "work3", [Path("images/valid")], 2)


def test_resume_checkpoint_lookup(tmp_path: Path) -> None:
    """--resume accepts a run dir, the train dir or last.pt itself and rejects anything without a checkpoint."""
    last = tmp_path / "run_x" / "train" / "weights" / "last.pt"
    last.parent.mkdir(parents=True)
    last.write_bytes(b"pt")
    for target in (tmp_path / "run_x", tmp_path / "run_x" / "train", last):
        assert train.resolve_resume_checkpoint(target) == last
        assert train_kaggle.resolve_resume_checkpoint(target) == last
    cfg = parse(["--resume", str(tmp_path / "run_x"), "--data", "d.yaml"])
    assert cfg.resume == last and cfg.model == str(last) and cfg.name == "run_x" and cfg.project == tmp_path
    assert cfg.preset == "stage-a" and cfg.imgsz == 960  # no saved config.yaml: preset defaults
    (tmp_path / "run_x" / "config.yaml").write_text("preset: smoke\nimgsz: 320\ndata: /d/data.yaml\nepochs: 4\n")
    cfg = parse(["--resume", str(tmp_path / "run_x")])
    assert (cfg.preset, cfg.imgsz, cfg.epochs, cfg.data, cfg.project) == ("smoke", 320, 4, Path("/d/data.yaml"), tmp_path)
    assert parse(["--resume", str(tmp_path / "run_x"), "--imgsz", "416"]).imgsz == 416
    saved = train_kaggle.build_plan(train_kaggle.build_parser().parse_args(["--resume", str(tmp_path / "run_x"), "--data", "d.yaml"]))
    assert saved["preset"] == "smoke" and saved["imgsz"] == 320 and saved["out_dir"] == str(tmp_path / "run_x")
    with pytest.raises(FileNotFoundError):
        train.resolve_resume_checkpoint(tmp_path / "missing")


def test_metrics_assembly_and_gate() -> None:
    """per_class_metrics derives accuracy from the confusion matrix like evaluate.py, and the gate lists failing classes."""
    box = SimpleNamespace(ap_class_index=np.array([0, 2]), p=np.array([0.9, 1.0]), r=np.array([0.8, 1.0]), f1=np.array([0.85, 0.99]), ap50=np.array([0.9, 0.99]), ap=np.array([0.7, 0.9]))
    matrix = np.zeros((4, 4))
    matrix[0, 0], matrix[1, 0], matrix[2, 2] = 8, 2, 5
    names = {0: "NMOS", 1: "PMOS", 2: "VDD", 3: "GND"}
    for module in (train, train_kaggle):
        got = module.per_class_metrics(box, names, SimpleNamespace(matrix=matrix), np.array([10, 0, 5, 0]))
        assert set(got) == {"NMOS", "VDD"}
        assert got["NMOS"]["accuracy"] == pytest.approx(0.8) and got["NMOS"]["instances"] == 10 and got["VDD"]["accuracy"] == pytest.approx(1.0)
        gate = module.gate_verdict(got)
        assert gate["failing_classes"] == ["NMOS"] and gate["passed"] is False
        assert module.gate_verdict({})["passed"] is False


def test_smoke_dataset_is_valid_yolo(smoke_data: Path) -> None:
    """The throwaway generator emits in-bounds labels, only schema class ids, and the three splits."""
    cfg = train.load_data_yaml(smoke_data)
    assert train.dataset_names(cfg)[:2] == ["NMOS", "PMOS"]
    for split, key in (("train", "train"), ("valid", "val"), ("test", "test")):
        images = train.split_images(cfg, smoke_data, key)
        assert images, split
        for image in images:
            rows = [r.split() for r in (smoke_data.parent / "labels" / split / f"{image.stem}.txt").read_text().splitlines()]
            assert rows and all(0 <= int(r[0]) < 14 and all(0.0 < float(v) <= 1.0 for v in r[1:]) for r in rows)


@pytest.mark.smoke
@pytest.mark.skipif(os.environ.get("DIGISIM_ML_SMOKE") != "1", reason="set DIGISIM_ML_SMOKE=1 to run the 2-epoch CPU training smoke test (downloads yolov8n.pt)")
def test_cpu_smoke_run_produces_metrics_and_onnx(tmp_path: Path) -> None:
    """2 epochs of the smoke preset on a 200-image throwaway set finish on CPU and write metrics.json plus an ONNX file."""
    data = make_smoke_dataset.generate(tmp_path / "ds", 200, seed=0)
    proc = subprocess.run(
        [sys.executable, str(ML_DIR / "train.py"), "--preset", "smoke", "--data", str(data), "--device", "cpu", "--workers", "2", "--project", str(tmp_path / "runs"), "--name", "smoke"],
        cwd=ML_DIR,
        capture_output=True,
        text=True,
        timeout=1800,
        env={**os.environ, "OMP_NUM_THREADS": "4", "YOLO_OFFLINE": os.environ.get("YOLO_OFFLINE", "")},
    )
    assert proc.returncode == 0, proc.stdout[-2000:] + proc.stderr[-2000:]
    run = tmp_path / "runs" / "smoke"
    metrics = json.loads((run / "metrics.json").read_text())
    assert metrics["schema_version"] == 1 and metrics["preset"] == "smoke" and metrics["settings"]["epochs"] == 2
    assert metrics["dataset"]["train_images"] == 140 and len(metrics["class_names"]) == 14
    assert (run / "best.pt").stat().st_size > 0
    assert (run / "best.onnx").stat().st_size > 0
