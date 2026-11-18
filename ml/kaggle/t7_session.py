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
Usage (kernel code file; settings come from the constants below or DIGISIM_* environment variables):
    python t7_session.py                       # full session
    DIGISIM_SMOKE=1 python t7_session.py       # a few minutes per stage to prove the path end to end
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


if __name__ == "__main__":
    sys.exit(main())
