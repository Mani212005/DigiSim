"""
Module: train.py
Purpose: Trains the DigiSim gate detector via YOLOv8 transfer learning (pretrained
         COCO weights — never random init) on the merged synthetic + hand-drawn
         dataset. Logs every run to ml/experiments/run_YYYYMMDD_HHMM/ with
         config.yaml, metrics.json and notes.md, and copies best weights to
         backend/model/weights/best.pt for the inference pipeline.

Usage:
    cd ml && uv run python train.py [--epochs 60] [--imgsz 416] [--notes "..."]
"""

import argparse
import json
import shutil
from datetime import datetime
from pathlib import Path

import yaml
from ultralytics import YOLO

ML_DIR = Path(__file__).resolve().parent
REPO_ROOT = ML_DIR.parent
DEFAULT_DATA = ML_DIR / "dataset" / "data.yaml"
WEIGHTS_DST = REPO_ROOT / "backend" / "model" / "weights" / "best.pt"


def train(args: argparse.Namespace) -> Path:
    """
    Run one training experiment and log it.

    Args:
        args: Parsed CLI arguments (data, model, epochs, imgsz, batch, notes).
    Returns:
        Path to the experiment run directory.
    Raises:
        FileNotFoundError: If the dataset yaml does not exist.
    """
    if not args.data.exists():
        raise FileNotFoundError(
            f"{args.data} not found — run backend/data_gen/screenshot_pipeline.py"
        )

    run_name = f"run_{datetime.now():%Y%m%d_%H%M}"
    run_dir = ML_DIR / "experiments" / run_name
    run_dir.mkdir(parents=True, exist_ok=True)

    config = {
        "base_model": args.model,
        "data": str(args.data),
        "epochs": args.epochs,
        "imgsz": args.imgsz,
        "batch": args.batch,
        "device": "cpu",
        "patience": args.patience,
        "seed": 0,
    }
    (run_dir / "config.yaml").write_text(yaml.safe_dump(config))
    (run_dir / "notes.md").write_text(
        f"# {run_name}\n\n{args.notes or 'No notes provided.'}\n"
    )

    model = YOLO(args.model)  # transfer learning from pretrained COCO weights
    model.train(
        data=str(args.data),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device="cpu",
        workers=args.workers,
        patience=args.patience,
        seed=0,
        project=str(run_dir),
        name="train",
        exist_ok=True,
        plots=True,
    )

    best = run_dir / "train" / "weights" / "best.pt"
    metrics = model.val(data=str(args.data), split="test", device="cpu", plots=True)
    summary = {
        "map50": float(metrics.box.map50),
        "map50_95": float(metrics.box.map),
        "mean_precision": float(metrics.box.mp),
        "mean_recall": float(metrics.box.mr),
        "weights": str(best),
    }
    (run_dir / "metrics.json").write_text(json.dumps(summary, indent=2))

    WEIGHTS_DST.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(best, WEIGHTS_DST)
    print(f"\nRun logged to {run_dir}")
    print(f"Best weights copied to {WEIGHTS_DST}")
    print("Run `uv run python evaluate.py` for per-class F1/accuracy.")
    return run_dir


def main() -> None:
    """
    CLI entry point.

    Raises:
        SystemExit: On argparse errors.
    """
    parser = argparse.ArgumentParser(description="Train DigiSim gate detector")
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--model", default="yolov8n.pt")
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--imgsz", type=int, default=416)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--patience", type=int, default=15)
    parser.add_argument("--notes", default="")
    train(parser.parse_args())


if __name__ == "__main__":
    main()
