"""
Module: t7_session.py
Purpose: Kaggle kernel driver for the T7 training runs: runs train_kaggle.py twice in one GPU session,
         stage A (synthetic pretrain from COCO yolov8s) and then stage B (mixed fine-tune of the stage-A
         best.pt with the real training images oversampled), each with a wall-clock budget so the whole
         session fits the weekly GPU quota. It is pushed as the kernel's code file; the dataset built by
         ml/kaggle/build_dataset.py carries train_kaggle.py, stage_a.yaml and stage_b.yaml.

         Stage B always starts fresh from the stage-A weights (never --resume: resuming a stage-B run
         loses the oversampling). Outputs: /kaggle/working/stage_a and /kaggle/working/stage_b, each with
         best.pt, best.onnx, metrics.json, config.yaml and the ultralytics train/val folders.

         DIGISIM_MODE=retrain runs only a second stage B from an earlier session's stage-A best.pt (attach that
         kernel's output): checkpoint selection on the real validation images only, no early stopping, stronger
         real oversampling and augmentation, and a synthetic subset boosted towards the classes that missed the
         gate (every gate image plus the transistor images richest in VDD, GND and INPUT_PORT).
         Output: /kaggle/working/stage_b_retrain.
Usage (kernel code file; settings come from the constants below or DIGISIM_* environment variables):
    python t7_session.py                       # full session
    DIGISIM_SMOKE=1 python t7_session.py       # a few minutes per stage to prove the path end to end
    DIGISIM_MODE=retrain python t7_session.py  # stage B retrain from an attached stage_a/best.pt
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

INPUT_ROOT = Path("/kaggle/input")
WORKING = Path("/kaggle/working")
STAGE_A_HOURS = float(os.environ.get("DIGISIM_STAGE_A_HOURS", "2.8"))
STAGE_B_HOURS = float(os.environ.get("DIGISIM_STAGE_B_HOURS", "1.8"))
SMOKE_HOURS = 0.04
IMGSZ = int(os.environ.get("DIGISIM_IMGSZ", "960"))
REAL_OVERSAMPLE = int(os.environ.get("DIGISIM_REAL_OVERSAMPLE", "4"))
RETRAIN_HOURS = float(os.environ.get("DIGISIM_RETRAIN_HOURS", "1.4"))
RETRAIN_IMGSZ = int(os.environ.get("DIGISIM_RETRAIN_IMGSZ", "1280"))
RETRAIN_BATCH = int(os.environ.get("DIGISIM_RETRAIN_BATCH", "16"))
RETRAIN_OVERSAMPLE = int(os.environ.get("DIGISIM_RETRAIN_OVERSAMPLE", "8"))
RETRAIN_TRANSISTOR_IMAGES = int(os.environ.get("DIGISIM_RETRAIN_TRANSISTOR_IMAGES", "1500"))
# Classes the boosted synthetic subset favours: every image with a gate, then images richest in these.
BOOST_GATES = ("AND", "OR", "NOT", "NAND", "NOR", "XOR", "XNOR")
BOOST_TERMINALS = ("VDD", "GND", "INPUT_PORT")
# Patience longer than any budgeted run: selection is by best real-validation fitness, never an early stop.
NO_EARLY_STOP = 1000


def find_dataset(root: Path = INPUT_ROOT) -> Path:
    """
    Locate the attached dataset folder (the one holding stage_a.yaml and train_kaggle.py).

    Args:
        root: Kaggle input root.
    Returns:
        The dataset folder.
    Raises:
        FileNotFoundError: If no attached dataset has stage_a.yaml.
    """
    for depth in range(5):
        for hit in sorted(root.glob("/".join(["*"] * depth + ["stage_a.yaml"]))):
            if (hit.parent / "train_kaggle.py").is_file():
                return hit.parent
    raise FileNotFoundError(f"no dataset with stage_a.yaml and train_kaggle.py under {root}")


def find_stage_a_weights(root: Path = INPUT_ROOT) -> Path:
    """
    Locate stage_a/best.pt in an attached earlier session's output.

    Args:
        root: Kaggle input root.
    Returns:
        The weights file.
    Raises:
        FileNotFoundError: If no attached input holds stage_a/best.pt.
    """
    for depth in range(5):
        hits = sorted(root.glob("/".join(["*"] * depth + ["stage_a", "best.pt"])))
        if hits:
            return hits[0]
    raise FileNotFoundError(f"no stage_a/best.pt under {root}: attach the earlier session's output")


def boosted_synth_images(dataset: Path, names: list[str], transistor_images: int) -> list[Path]:
    """
    The synthetic training subset for the retrain: every image with a gate, plus the transistor images richest in supplies and inputs.

    Args:
        dataset: Dataset folder (holds synth/images/train and synth/labels/train).
        names: Class names in id order.
        transistor_images: How many gate-free images to add, most VDD + GND + INPUT_PORT instances first (ties by name).
    Returns:
        Absolute image paths, gate images first.
    """
    gate_ids = {str(names.index(n)) for n in BOOST_GATES}
    terminal_ids = {str(names.index(n)) for n in BOOST_TERMINALS}
    gates: list[Path] = []
    others: list[tuple[int, str, Path]] = []
    for label in sorted((dataset / "synth" / "labels" / "train").glob("*.txt")):
        image = dataset / "synth" / "images" / "train" / f"{label.stem}.jpg"
        ids = [line.split()[0] for line in label.read_text().splitlines() if line.strip()]
        if gate_ids & set(ids):
            gates.append(image)
        else:
            others.append((-sum(i in terminal_ids for i in ids), label.stem, image))
    return gates + [image for _, _, image in sorted(others)[:transistor_images]]


def write_retrain_yaml(dataset: Path, out_dir: Path, transistor_images: int) -> Path:
    """
    Write the retrain dataset yaml: boosted synthetic train list, real-only validation, real test (reported, never selected on).

    Args:
        dataset: Dataset folder (holds stage_b.yaml, synth/ and real/).
        out_dir: Writable folder for the yaml and the train list.
        transistor_images: Gate-free synthetic images to include (see boosted_synth_images).
    Returns:
        Path of the written yaml (absolute paths throughout, so it works from any folder).
    """
    import yaml

    names = list(yaml.safe_load((dataset / "stage_b.yaml").read_text())["names"])
    out_dir.mkdir(parents=True, exist_ok=True)
    train_list = out_dir / "synth_boost.txt"
    train_list.write_text("".join(f"{p.resolve()}\n" for p in boosted_synth_images(dataset, names, transistor_images)))
    cfg = {
        "train": str(train_list),
        "val": str((dataset / "real" / "images" / "valid").resolve()),
        "test": str((dataset / "real" / "images" / "test").resolve()),
        "nc": len(names),
        "names": names,
    }
    out = out_dir / "retrain.yaml"
    out.write_text(yaml.safe_dump(cfg, sort_keys=False))
    return out


def run_stage(dataset: Path, args: list[str], log_name: str) -> float:
    """
    Run train_kaggle.py with the given arguments, streaming its output to the kernel log and a file.

    Args:
        dataset: Dataset folder (holds train_kaggle.py).
        args: Arguments for train_kaggle.py.
        log_name: Log file name under /kaggle/working.
    Returns:
        Wall-clock seconds the stage took.
    Raises:
        subprocess.CalledProcessError: If the trainer exits non-zero.
    """
    started = time.time()
    cmd = [sys.executable, str(dataset / "train_kaggle.py"), *args]
    print("+", " ".join(cmd), flush=True)
    with (WORKING / log_name).open("w") as log:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=str(WORKING))
        assert proc.stdout is not None
        for line in proc.stdout:
            sys.stdout.write(line)
            log.write(line)
        code = proc.wait()
    if code != 0:
        raise subprocess.CalledProcessError(code, cmd)
    return time.time() - started


def main() -> int:
    """
    Run stage A then stage B and write a session summary.

    Returns:
        Process exit code (0 on success).
    """
    if os.environ.get("DIGISIM_MODE") == "retrain":
        return retrain()
    smoke = os.environ.get("DIGISIM_SMOKE") == "1"
    hours_a = SMOKE_HOURS if smoke else STAGE_A_HOURS
    hours_b = SMOKE_HOURS if smoke else STAGE_B_HOURS
    dataset = find_dataset()
    print(f"dataset: {dataset}  smoke={smoke}  stage A {hours_a} h, stage B {hours_b} h, imgsz {IMGSZ}", flush=True)
    subprocess.check_call(["nvidia-smi"])
    summary: dict[str, object] = {"dataset": str(dataset), "smoke": smoke, "imgsz": IMGSZ}
    common = ["--device", "auto", "--imgsz", str(IMGSZ)]
    out_a = WORKING / "stage_a"
    summary["stage_a_seconds"] = run_stage(dataset, ["--preset", "stage-a", "--data", str(dataset / "stage_a.yaml"), "--time", str(hours_a), "--out", str(out_a), *common], "stage_a.log")
    out_b = WORKING / "stage_b"
    stage_b_args = [
        "--preset",
        "stage-b",
        "--data",
        str(dataset / "stage_b.yaml"),
        "--model",
        str(out_a / "best.pt"),
        "--real-train",
        "real/images/train",
        "--real-oversample",
        str(REAL_OVERSAMPLE),
        "--time",
        str(hours_b),
        "--out",
        str(out_b),
        "--skip-install",
        *common,
    ]
    summary["stage_b_seconds"] = run_stage(dataset, stage_b_args, "stage_b.log")
    (WORKING / "session_summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    return 0


def retrain() -> int:
    """
    Run the stage-B retrain from an attached stage-A best.pt and write a session summary.

    Returns:
        Process exit code (0 on success).
    """
    dataset = find_dataset()
    weights = find_stage_a_weights()
    data_yaml = write_retrain_yaml(dataset, WORKING / "retrain_data", RETRAIN_TRANSISTOR_IMAGES)
    print(f"retrain: dataset {dataset}, base {weights}, {RETRAIN_HOURS} h at imgsz {RETRAIN_IMGSZ}", flush=True)
    subprocess.check_call(["nvidia-smi"])
    args = [
        "--preset",
        "stage-b",
        "--data",
        str(data_yaml),
        "--model",
        str(weights),
        "--real-train",
        str((dataset / "real" / "images" / "train").resolve()),
        "--real-oversample",
        str(RETRAIN_OVERSAMPLE),
        "--augment",
        "strong",
        "--patience",
        str(NO_EARLY_STOP),
        "--time",
        str(RETRAIN_HOURS),
        "--imgsz",
        str(RETRAIN_IMGSZ),
        "--batch",
        str(RETRAIN_BATCH),
        "--device",
        "auto",
        "--out",
        str(WORKING / "stage_b_retrain"),
    ]
    summary = {"mode": "retrain", "dataset": str(dataset), "base_weights": str(weights), "imgsz": RETRAIN_IMGSZ, "seconds": run_stage(dataset, args, "stage_b_retrain.log")}
    (WORKING / "session_summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
