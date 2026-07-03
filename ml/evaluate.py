"""
Module: evaluate.py
Purpose: Evaluates the trained gate detector on the test split and prints
         per-class F1 and accuracy plus overall mAP@0.5 — the numbers that gate
         phase advancement (F1 ≥ 0.95 and accuracy ≥ 0.95 per class). Accuracy
         is computed from the confusion matrix as TP / total ground truth of the
         class (misses and misclassifications both count against it).

Usage:
    cd ml && uv run python evaluate.py [--weights ../backend/model/weights/best.pt]
"""

import argparse
import json
from pathlib import Path

import numpy as np
from ultralytics import YOLO

ML_DIR = Path(__file__).resolve().parent
REPO_ROOT = ML_DIR.parent
DEFAULT_WEIGHTS = REPO_ROOT / "backend" / "model" / "weights" / "best.pt"
DEFAULT_DATA = ML_DIR / "dataset" / "data.yaml"

F1_THRESHOLD = 0.95
ACC_THRESHOLD = 0.95


def evaluate(weights: Path, data: Path, split: str) -> dict:
    """
    Run validation and assemble per-class metrics.

    Args:
        weights: Path to trained .pt weights.
        data: Dataset yaml path.
        split: Dataset split to evaluate ('test' or 'val').
    Returns:
        Dict with per-class metrics and overall mAP.
    Raises:
        FileNotFoundError: If weights or dataset yaml are missing.
    """
    if not weights.exists():
        raise FileNotFoundError(f"Weights not found: {weights} — train first")
    if not data.exists():
        raise FileNotFoundError(f"Dataset yaml not found: {data}")

    model = YOLO(str(weights))
    # plots=True is required: ultralytics only accumulates the confusion
    # matrix (our accuracy source) when plotting is enabled.
    metrics = model.val(
        data=str(data),
        split=split,
        device="cpu",
        plots=True,
        project=str(ML_DIR / "experiments" / "eval"),
        name=split,
        exist_ok=True,
    )
    names: dict[int, str] = model.names

    per_class: dict[str, dict[str, float]] = {}
    f1 = np.atleast_1d(metrics.box.f1)
    idx = np.atleast_1d(metrics.box.ap_class_index).astype(int)
    for pos, cls_id in enumerate(idx):
        per_class[names[cls_id]] = {"f1": float(f1[pos])}

    # Accuracy from the confusion matrix: TP / total GT instances per class.
    cm = getattr(metrics, "confusion_matrix", None)
    if cm is not None:
        matrix = cm.matrix  # rows = predictions, cols = ground truth
        for cls_id, name in names.items():
            gt_total = float(matrix[:, cls_id].sum())
            if gt_total > 0:
                acc = float(matrix[cls_id, cls_id]) / gt_total
                per_class.setdefault(name, {})["accuracy"] = acc

    return {
        "split": split,
        "map50": float(metrics.box.map50),
        "map50_95": float(metrics.box.map),
        "per_class": per_class,
    }


def print_report(report: dict) -> bool:
    """
    Print the per-class metric table and threshold verdicts.

    Args:
        report: Output of evaluate().
    Returns:
        True when every reported class passes both thresholds.
    """
    print(f"\n=== DigiSim gate detector — split: {report['split']} ===")
    print(f"mAP@0.5      : {report['map50']:.4f}")
    print(f"mAP@0.5:0.95 : {report['map50_95']:.4f}\n")
    print(f"{'class':<10} {'F1':>7} {'acc':>7}  verdict")

    all_pass = True
    for name, m in report["per_class"].items():
        f1 = m.get("f1", float("nan"))
        acc = m.get("accuracy", float("nan"))
        ok = f1 >= F1_THRESHOLD and acc >= ACC_THRESHOLD
        all_pass = all_pass and ok
        print(f"{name:<10} {f1:>7.4f} {acc:>7.4f}  {'PASS' if ok else 'FAIL'}")

    verdict = "ALL CLASSES PASS" if all_pass else "THRESHOLD NOT MET"
    print(f"\n{verdict} (need F1 ≥ {F1_THRESHOLD} and acc ≥ {ACC_THRESHOLD})")
    return all_pass


def main() -> None:
    """
    CLI entry point — prints the report and writes it next to the weights.

    Raises:
        SystemExit: On argparse errors.
    """
    parser = argparse.ArgumentParser(description="Evaluate DigiSim gate detector")
    parser.add_argument("--weights", type=Path, default=DEFAULT_WEIGHTS)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--split", default="test")
    args = parser.parse_args()

    report = evaluate(args.weights, args.data, args.split)
    print_report(report)
    out = args.weights.parent / f"eval_{args.split}.json"
    out.write_text(json.dumps(report, indent=2))
    print(f"Report written to {out}")


if __name__ == "__main__":
    main()
