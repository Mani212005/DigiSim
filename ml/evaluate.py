"""
Module: evaluate.py
Purpose: Evaluation harness v2 for the DigiSim symbol detector and the image -> circuit pipeline.
         One run writes one JSON and one Markdown report containing:
           - detection: per-class and per-domain precision / recall / F1 / accuracy with Wilson 95% CIs,
             a confusion matrix, small-object (junction) recall;
           - end-to-end (optional): net precision/recall/F1 over pin pairs, netlist exact-match rate and
             truth-table equivalence of the reconstructed circuit under DigiSim's simulator;
           - legacy: the ultralytics-validation numbers the original phase gate used (mAP, max-F1 per
             class, confusion-matrix accuracy), so old results stay reproducible;
           - a frozen-set integrity check: the run refuses to start when the test split's SHA-256 no
             longer matches ml/frozen_sets.json.
         "accuracy" is TP / ground-truth instances of the class (misses and misclassifications both count
         against it), the number the F1 >= 0.95 / accuracy >= 0.95 phase gate uses.

Usage:
    cd ml
    uv run python evaluate.py --weights W.pt --data DATASET/data.yaml --frozen-name gate12_test
    uv run python evaluate.py ... --freeze --freeze-note "what this set is"     # register a new frozen set (reviewed change)
    uv run python evaluate.py ... --gt-netlists DIR --pred-netlists DIR         # add end-to-end metrics
    uv run python evaluate.py ... --reproduce eval_test.json --baseline baselines/gate12.json
Exit codes: 0 ok, 3 frozen-set check failed, 4 reproduction out of tolerance.
"""

import argparse
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from class_schema import load_schema
from eval_frozen import DEFAULT_REGISTRY, IMAGE_SUFFIXES, FrozenSetError, SplitDigest, file_sha256, freeze, hash_split, infer_frozen_name, verify_frozen
from eval_metrics import (
    DEFAULT_DOMAIN_RULES,
    DEFAULT_SMALL_PX,
    IOU_MATCH_THRESHOLD,
    DetectionAccumulator,
    domain_for,
    drop_ignored,
    parse_domain_rule,
)
from eval_netlist import evaluate_netlists
from eval_report import render_markdown

ML_DIR = Path(__file__).resolve().parent
REPO_ROOT = ML_DIR.parent
DEFAULT_WEIGHTS = REPO_ROOT / "backend" / "model" / "weights" / "best.pt"
DEFAULT_DATA = ML_DIR / "dataset" / "data.yaml"
DEFAULT_OUT_DIR = ML_DIR / "experiments" / "eval"

F1_THRESHOLD = 0.95
ACC_THRESHOLD = 0.95
# Predictions are generated once at this floor so any operating confidence can be derived from them.
PREDICT_CONF_FLOOR = 0.001
DEFAULT_OPERATING_CONF = 0.35  # production DETECTION_CONFIDENCE_THRESHOLD (backend/pipeline/detector.py)
DEFAULT_TOLERANCE = 0.02
OMP_THREADS = "4"
# Ignore-region reasons (ml/data_real/yolo/ignore/<split>/<stem>.json, written by real_data.build) masked by default:
# objects we could not label (undecided polarity, terminal role or supply). Unmapped classes stay scored, so a
# tier A prediction on, say, an op-amp still counts as a false positive.
DEFAULT_IGNORE_REASONS = ("uncertain_fet", "uncertain_supply", "uncertain_terminal")
# Domain suffix for synthetic test images the generator rendered in held-out styles (manifest.json held_out_style).
HELD_OUT_STYLE_SUFFIX = "_heldout_style"
EXIT_FROZEN = 3
EXIT_REPRODUCTION = 4


@dataclass(frozen=True)
class DatasetInfo:
    """A YOLO dataset resolved from its data.yaml."""

    root: Path
    names: tuple[str, ...]
    images_dir: Path
    labels_dir: Path
    netlists_dir: Path


def load_dataset_info(data: Path, split: str) -> DatasetInfo:
    """
    Resolve dataset root, class names and the split's image/label directories from data.yaml.

    Args:
        data: Path to a YOLO data.yaml.
        split: Split key ('test', 'val', ...), resolved through the yaml like ultralytics does.
    Returns:
        The DatasetInfo.
    Raises:
        FileNotFoundError: If the yaml or the split directory does not exist.
        ValueError: If the yaml has no class names or no entry for the split.
    """
    import yaml

    if not data.exists():
        raise FileNotFoundError(f"Dataset yaml not found: {data}")
    doc = yaml.safe_load(data.read_text())
    raw_names = doc.get("names")
    names = tuple(raw_names[i] for i in sorted(raw_names)) if isinstance(raw_names, dict) else tuple(raw_names or ())
    if not names:
        raise ValueError(f"{data}: no class names")
    key = "val" if split == "valid" and "valid" not in doc else split
    if key not in doc:
        raise ValueError(f"{data}: no entry for split {split!r}")
    root = Path(doc.get("path", data.parent))
    if not root.is_absolute():
        root = (data.parent / root).resolve()
    images_dir = root / str(doc[key])
    if not images_dir.is_dir():
        raise FileNotFoundError(f"Split images directory missing: {images_dir}")
    return DatasetInfo(root=root, names=names, images_dir=images_dir, labels_dir=sibling_dir(images_dir, "labels"), netlists_dir=sibling_dir(images_dir, "netlists"))


def held_out_style_images(root: Path) -> frozenset[str]:
    """
    Image file names the synthetic generator flagged as held-out styles (generate_v2 manifest.json at the dataset root).

    Args:
        root: Dataset root (holds manifest.json for generate_v2 output).
    Returns:
        The flagged image file names; empty when the dataset has no generator manifest.
    """
    manifest = root / "manifest.json"
    if not manifest.is_file():
        return frozenset()
    samples = json.loads(manifest.read_text()).get("samples")
    if not isinstance(samples, list):
        return frozenset()
    return frozenset(Path(s["files"]["image"]["path"]).name for s in samples if s.get("held_out_style"))


def sibling_dir(images_dir: Path, name: str) -> Path:
    """
    The directory beside a split's images, found the way ultralytics finds labels: the last 'images' path component is swapped.

    Args:
        images_dir: The split's images directory.
        name: Replacement component ('labels', 'netlists').
    Returns:
        The sibling directory path.
    Raises:
        ValueError: If images_dir has no 'images' path component.
    """
    parts = list(images_dir.parts)
    if "images" not in parts:
        raise ValueError(f"{images_dir}: the split directory must have an 'images' path component")
    parts[len(parts) - 1 - parts[::-1].index("images")] = name
    return Path(*parts)


def read_labels(label_file: Path, width: int, height: int) -> np.ndarray:
    """
    Read a YOLO label file into pixel-space ground-truth rows.

    Args:
        label_file: YOLO .txt (class xc yc w h, or class x1 y1 x2 y2 ... polygon, all normalised); may not exist.
        width: Image width in pixels.
        height: Image height in pixels.
    Returns:
        (n, 5) float array of [cls, x1, y1, x2, y2] in pixels (empty when the file is missing or empty).
    Raises:
        ValueError: If a line is malformed.
    """
    rows: list[list[float]] = []
    if label_file.exists():
        for line in label_file.read_text().splitlines():
            parts = line.split()
            if not parts:
                continue
            vals = [float(v) for v in parts]
            if len(vals) == 5:
                cx, cy, w, h = vals[1:]
                x1, y1, x2, y2 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
            elif len(vals) >= 7 and len(vals) % 2 == 1:
                xs, ys = vals[1::2], vals[2::2]
                x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
            else:
                raise ValueError(f"{label_file}: malformed label line {line!r}")
            rows.append([vals[0], x1 * width, y1 * height, x2 * width, y2 * height])
    return np.asarray(rows, dtype=np.float64).reshape(-1, 5)


def read_ignore(ignore_file: Path, reasons: tuple[str, ...]) -> np.ndarray:
    """
    Read one image's ignore regions (pixel xyxy) whose reason is in `reasons`.

    Args:
        ignore_file: JSON list of {"reason", "xyxy", ...} records; may not exist.
        reasons: Reasons to keep (empty keeps none).
    Returns:
        (k, 4) float array of xyxy boxes in pixels (empty when the file is missing or nothing matches).
    Raises:
        ValueError: If the file is not a list of records with a 4-number xyxy.
    """
    if not reasons or not ignore_file.exists():
        return np.zeros((0, 4), dtype=np.float64)
    records = json.loads(ignore_file.read_text())
    if not isinstance(records, list):
        raise ValueError(f"{ignore_file}: expected a JSON list")
    boxes = [r["xyxy"] for r in records if isinstance(r, dict) and r.get("reason") in reasons]
    if any(len(b) != 4 for b in boxes):
        raise ValueError(f"{ignore_file}: every xyxy needs 4 numbers")
    return np.asarray(boxes, dtype=np.float64).reshape(-1, 4)


def build_class_map(model_names: dict[int, str], dataset_names: tuple[str, ...], aliases: dict[str, str]) -> list[int]:
    """
    Map each model class id to a dataset class id by name, then by legacy alias.

    Args:
        model_names: Model class id -> name (as stored in the weights).
        dataset_names: Dataset class names ordered by id.
        aliases: Legacy alias -> canonical class name (ml/classes.yaml).
    Returns:
        List indexed by model class id giving the dataset class id, or -1 when the model class has no
        counterpart in the dataset vocabulary (such predictions are counted as unmapped).
    """
    index = {name: i for i, name in enumerate(dataset_names)}
    mapping = []
    for cls_id in range(max(model_names) + 1 if model_names else 0):
        name = model_names.get(cls_id, "")
        canonical = aliases.get(name, aliases.get(name.upper(), name))
        mapping.append(index.get(name, index.get(canonical, -1)))
    return mapping


def predict_split(weights: Path, image_paths: list[Path], imgsz: int, device: str) -> tuple[dict[int, str], dict[str, tuple[np.ndarray, tuple[int, int]]]]:
    """
    Run the detector once over a list of images at a very low confidence floor.

    Images are predicted one at a time: given a list source, ultralytics decodes every image into memory before
    the first prediction, which runs out of RAM on a split of several hundred images.

    Args:
        weights: Trained .pt weights.
        image_paths: Images to run.
        imgsz: Inference image size.
        device: Torch device string ('cpu', '0', ...).
    Returns:
        (model class names, mapping image name -> (predictions [cls, conf, x1, y1, x2, y2], (height, width))).
    Raises:
        FileNotFoundError: If the weights do not exist.
    """
    from ultralytics import YOLO

    if not weights.exists():
        raise FileNotFoundError(f"Weights not found: {weights} - train first")
    model = YOLO(str(weights))
    out: dict[str, tuple[np.ndarray, tuple[int, int]]] = {}
    for path in image_paths:
        result = model.predict(source=str(path), imgsz=imgsz, conf=PREDICT_CONF_FLOOR, device=device, verbose=False)[0]
        boxes = result.boxes
        xyxy = boxes.xyxy.cpu().numpy()
        conf = boxes.conf.cpu().numpy()
        cls = boxes.cls.cpu().numpy()
        preds = np.column_stack([cls, conf, xyxy]) if len(cls) else np.zeros((0, 6))
        out[path.name] = (preds, (int(result.orig_shape[0]), int(result.orig_shape[1])))
    return {int(k): str(v) for k, v in model.names.items()}, out


def evaluate_detection(
    info: DatasetInfo,
    weights: Path,
    imgsz: int,
    conf: float,
    iou: float,
    small_px: float,
    device: str,
    domain_rules: tuple[tuple[str, str], ...],
    ignore_reasons: tuple[str, ...] = DEFAULT_IGNORE_REASONS,
) -> dict[str, Any]:
    """
    Per-class and per-domain detection metrics at one operating confidence.

    Args:
        info: Resolved dataset.
        weights: Trained .pt weights.
        imgsz: Inference image size.
        conf: Operating confidence threshold applied to the raw predictions.
        iou: IoU threshold for prediction-to-GT matching.
        small_px: Longest-side threshold (pixels) for the small-object recall.
        device: Torch device string.
        domain_rules: (filename prefix, domain) rules; images flagged held_out_style in the dataset manifest get the
            domain plus "_heldout_style".
        ignore_reasons: Ignore-region reasons to mask (read from the split's sibling `ignore` directory when it exists).
    Returns:
        Dict with overall, per_class, per_domain, confusion_matrix, junction_recall, ignore-masking counts and operating-point settings.
    Raises:
        FileNotFoundError: If the weights are missing or the split holds no images.
    """
    images = sorted(p for p in info.images_dir.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
    if not images:
        raise FileNotFoundError(f"No images in {info.images_dir}")
    model_names, predictions = predict_split(weights, images, imgsz, device)
    class_map = np.asarray(build_class_map(model_names, info.names, load_schema().aliases), dtype=np.int64)
    n = len(info.names)
    overall = DetectionAccumulator(n, small_px, iou)
    per_domain: dict[str, DetectionAccumulator] = {}
    held_out = held_out_style_images(info.root)
    ignore_dir = sibling_dir(info.images_dir, "ignore")
    use_ignore = bool(ignore_reasons) and ignore_dir.is_dir()
    ignore_regions = 0
    ignored_predictions = 0
    for path in images:
        preds, (height, width) = predictions[path.name]
        preds = preds[preds[:, 1] >= conf] if len(preds) else preds
        if len(preds):
            preds = preds.copy()
            preds[:, 0] = class_map[preds[:, 0].astype(int)]
        gt = read_labels(info.labels_dir / f"{path.stem}.txt", width, height)
        if use_ignore:
            ignore = read_ignore(ignore_dir / f"{path.stem}.json", ignore_reasons)
            ignore_regions += len(ignore)
            preds, dropped = drop_ignored(gt, preds if len(preds) else np.zeros((0, 6)), ignore, iou)
            ignored_predictions += dropped
        overall.add_image(gt, preds)
        domain = domain_for(path.name, domain_rules) + (HELD_OUT_STYLE_SUFFIX if path.name in held_out else "")
        per_domain.setdefault(domain, DetectionAccumulator(n, small_px, iou)).add_image(gt, preds)
    per_class = overall.per_class(info.names)
    return {
        "conf": conf,
        "iou_threshold": iou,
        "model_classes": [model_names[i] for i in sorted(model_names)],
        "class_map": {model_names.get(i, str(i)): (info.names[c] if c >= 0 else None) for i, c in enumerate(class_map.tolist())},
        "overall": overall.overall(),
        "per_class": per_class,
        "per_domain": {d: {"overall": acc.overall(), "per_class": acc.per_class(info.names)} for d, acc in sorted(per_domain.items())},
        "confusion_matrix": overall.confusion(info.names),
        "junction_recall": per_class["JUNCTION"]["recall"] if "JUNCTION" in per_class else None,
        "ignore_masking": {"reasons": list(ignore_reasons) if use_ignore else [], "regions": ignore_regions, "dropped_predictions": ignored_predictions},
    }


def evaluate(weights: Path, data: Path, split: str, imgsz: int = 640, project: Path | None = None, device: str = "cpu") -> dict[str, Any]:
    """
    Legacy ultralytics validation: mAP plus max-F1 per class and confusion-matrix accuracy.

    This is exactly what the original phase gate used; it stays so old numbers remain reproducible.

    Args:
        weights: Path to trained .pt weights.
        data: Dataset yaml path.
        split: Dataset split to evaluate ('test' or 'val').
        imgsz: Validation image size.
        project: Directory for ultralytics' validation artefacts (defaults to ml/experiments/eval).
        device: Torch device string.
    Returns:
        Dict with split, map50, map50_95 and per_class {f1, accuracy}.
    Raises:
        FileNotFoundError: If weights or dataset yaml are missing.
    """
    from ultralytics import YOLO

    if not weights.exists():
        raise FileNotFoundError(f"Weights not found: {weights} - train first")
    if not data.exists():
        raise FileNotFoundError(f"Dataset yaml not found: {data}")

    model = YOLO(str(weights))
    # plots=True is required: ultralytics only accumulates the confusion
    # matrix (our accuracy source) when plotting is enabled.
    metrics = model.val(
        data=str(data),
        split=split,
        imgsz=imgsz,
        device=device,
        workers=0,
        plots=True,
        project=str(project or DEFAULT_OUT_DIR),
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


def print_report(report: dict[str, Any]) -> bool:
    """
    Print the legacy per-class metric table and threshold verdicts.

    Args:
        report: Output of evaluate().
    Returns:
        True when every reported class passes both thresholds.
    """
    print(f"\n=== DigiSim detector (ultralytics validation) - split: {report['split']} ===")
    print(f"mAP@0.5      : {report['map50']:.4f}")
    print(f"mAP@0.5:0.95 : {report['map50_95']:.4f}\n")
    print(f"{'class':<12} {'F1':>7} {'acc':>7}  verdict")

    all_pass = True
    for name, m in report["per_class"].items():
        f1 = m.get("f1", float("nan"))
        acc = m.get("accuracy", float("nan"))
        ok = f1 >= F1_THRESHOLD and acc >= ACC_THRESHOLD
        all_pass = all_pass and ok
        print(f"{name:<12} {f1:>7.4f} {acc:>7.4f}  {'PASS' if ok else 'FAIL'}")

    verdict = "ALL CLASSES PASS" if all_pass else "THRESHOLD NOT MET"
    print(f"\n{verdict} (need F1 >= {F1_THRESHOLD} and acc >= {ACC_THRESHOLD})")
    return all_pass


def reproduction_check(legacy: dict[str, Any], reference: dict[str, Any], tolerance: float, reference_name: str) -> dict[str, Any]:
    """
    Compare a legacy validation block with a reference (e.g. the old eval_test.json).

    Args:
        legacy: Output of evaluate().
        reference: Reference report with map50, map50_95 and per_class {f1, accuracy}.
        tolerance: Maximum allowed absolute difference per metric.
        reference_name: Name recorded in the report.
    Returns:
        Dict with reference, tolerance, rows (metric, reference, value, delta), max_abs_delta and ok.
    """
    rows: list[dict[str, Any]] = []

    def add(metric: str, ref_value: float, value: float | None) -> None:
        """Append one comparison row; a metric absent from the run has value/delta None and fails the check."""
        rows.append({"metric": metric, "reference": float(ref_value), "value": value, "delta": None if value is None else value - float(ref_value)})

    for key in ("map50", "map50_95"):
        if key in reference:
            add(key, reference[key], float(legacy[key]) if key in legacy else None)
    for name, ref in reference.get("per_class", {}).items():
        for key in ("f1", "accuracy"):
            if key in ref:
                got = legacy["per_class"].get(name, {}).get(key)
                add(f"{name}.{key}", ref[key], None if got is None else float(got))
    missing = [r["metric"] for r in rows if r["delta"] is None]
    deltas = [abs(r["delta"]) for r in rows if r["delta"] is not None]
    worst = max(deltas) if deltas else None
    ok = bool(rows) and not missing and worst is not None and worst <= tolerance
    return {"reference": reference_name, "tolerance": tolerance, "rows": rows, "max_abs_delta": worst, "missing": missing, "ok": ok}


def git_commit() -> str | None:
    """
    The current git commit of the repository, for provenance.

    Returns:
        The commit hash, or None if git is unavailable.
    """
    try:
        proc = subprocess.run(["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"], capture_output=True, text=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None
    return proc.stdout.strip()


def build_parser() -> argparse.ArgumentParser:
    """
    The command-line parser.

    Returns:
        Configured ArgumentParser.
    """
    p = argparse.ArgumentParser(description="DigiSim evaluation harness v2")
    p.add_argument("--weights", type=Path, default=DEFAULT_WEIGHTS)
    p.add_argument("--data", type=Path, default=DEFAULT_DATA)
    p.add_argument("--split", default="test")
    p.add_argument("--frozen-name", help="Frozen set to verify (inferred from the registry when one entry has this split and class list; required for the test split otherwise)")
    p.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)
    p.add_argument("--freeze", action="store_true", help="Register the split as a new frozen set, then exit")
    p.add_argument("--freeze-note", default="", help="Provenance note stored with --freeze")
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--conf", type=float, default=DEFAULT_OPERATING_CONF, help="Operating confidence for P/R/F1")
    p.add_argument("--iou", type=float, default=IOU_MATCH_THRESHOLD)
    p.add_argument("--small-px", type=float, default=DEFAULT_SMALL_PX, help="GT boxes with longest side <= this are 'small objects'")
    p.add_argument("--device", default="cpu")
    p.add_argument(
        "--ignore-reason",
        action="append",
        default=None,
        help=f"ignore-region reason to mask (repeatable; default {', '.join(DEFAULT_IGNORE_REASONS)}; 'none' disables masking)",
    )
    p.add_argument("--domain-rule", action="append", default=[], metavar="PREFIX=NAME", help="Extra filename-prefix domain rule (repeatable)")
    p.add_argument("--skip-legacy", action="store_true", help="Skip the ultralytics validation block")
    p.add_argument("--gt-netlists", type=Path, help="Directory of ground-truth netlists (<image stem>.json)")
    p.add_argument("--pred-netlists", type=Path, help="Directory of predicted netlists (<image stem>.json)")
    p.add_argument("--no-truth-table", action="store_true", help="Skip simulator-based truth-table equivalence")
    p.add_argument("--reproduce", type=Path, help="Reference eval JSON (e.g. the old eval_test.json) the legacy block must match")
    p.add_argument("--tolerance", type=float, default=DEFAULT_TOLERANCE)
    p.add_argument("--baseline", type=Path, help="Earlier report JSON to show deltas against")
    p.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    p.add_argument("--run-name", help="Output file stem (default: the frozen set name, else <dataset dir>_<split>)")
    return p


def main(argv: list[str] | None = None) -> int:
    """
    CLI entry point: verify the frozen set, run the requested evaluations, write the JSON and Markdown.

    Args:
        argv: Argument list (defaults to sys.argv[1:]).
    Returns:
        Process exit code (0 ok, 3 frozen-set failure, 4 reproduction out of tolerance).
    Raises:
        SystemExit: On argparse errors or invalid options.
    """
    parser = build_parser()
    args = parser.parse_args(argv)
    os.environ.setdefault("OMP_NUM_THREADS", OMP_THREADS)
    try:
        rules = (*(parse_domain_rule(r) for r in args.domain_rule), *DEFAULT_DOMAIN_RULES)
    except ValueError as exc:
        parser.error(str(exc))
    if bool(args.gt_netlists) != bool(args.pred_netlists):
        parser.error("--gt-netlists and --pred-netlists go together")

    info = load_dataset_info(args.data, args.split)
    digest: SplitDigest = hash_split(info.images_dir, info.labels_dir, args.gt_netlists or info.netlists_dir, info.names, sibling_dir(info.images_dir, "ignore"))
    if not args.freeze and not args.frozen_name:
        args.frozen_name = infer_frozen_name(args.split, info.names, args.registry)
        if args.split == "test" and not args.frozen_name:
            parser.error("the test split must be hash-verified: pass --frozen-name (no single registered frozen set has this split and class list)")
    if args.freeze:
        if not args.frozen_name:
            parser.error("--freeze needs --frozen-name")
        try:
            freeze(args.frozen_name, digest, args.split, args.freeze_note, args.registry)
        except FrozenSetError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return EXIT_FROZEN
        print(f"froze {args.frozen_name}: sha256 {digest.sha256} ({digest.images} images, {digest.labels} labels, {digest.netlists} netlists)")
        return 0
    if args.frozen_name:
        try:
            verify_frozen(args.frozen_name, digest, args.registry)
        except FrozenSetError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return EXIT_FROZEN

    report: dict[str, Any] = {
        "schema": "digisim.eval/2",
        "run": {
            "name": args.run_name or args.frozen_name or f"{info.root.name}_{args.split}",
            "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "git_commit": git_commit(),
            "weights": {"name": args.weights.name, "sha256": file_sha256(args.weights) if args.weights.exists() else None},
            "dataset": {
                "frozen_name": args.frozen_name,
                "split": args.split,
                "images": digest.images,
                "labels": digest.labels,
                "netlists": digest.netlists,
                "sha256": digest.sha256,
                "classes": list(info.names),
            },
            "params": {"imgsz": args.imgsz, "conf": args.conf, "iou": args.iou, "small_px": args.small_px, "device": args.device},
        },
    }
    status = 0
    reasons = tuple(r for r in (args.ignore_reason or DEFAULT_IGNORE_REASONS) if r != "none")
    report["detection"] = evaluate_detection(info, args.weights, args.imgsz, args.conf, args.iou, args.small_px, args.device, rules, reasons)
    if not args.skip_legacy:
        report["legacy"] = evaluate(args.weights, args.data, args.split, args.imgsz, args.out_dir / "ultralytics_val", args.device)
        print_report(report["legacy"])
        if args.reproduce:
            repro = reproduction_check(report["legacy"], json.loads(args.reproduce.read_text()), args.tolerance, args.reproduce.name)
            report["reproduction"] = repro
            if not repro["ok"]:
                status = EXIT_REPRODUCTION
    elif args.reproduce:
        parser.error("--reproduce needs the legacy block (drop --skip-legacy)")
    if args.gt_netlists:
        report["end_to_end"] = evaluate_netlists(args.gt_netlists, args.pred_netlists, not args.no_truth_table, rules)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    stem = report["run"]["name"]
    baseline = json.loads(args.baseline.read_text()) if args.baseline else None
    (args.out_dir / f"{stem}.json").write_text(json.dumps(report, indent=2) + "\n")
    (args.out_dir / f"{stem}.md").write_text(render_markdown(report, baseline))
    print(f"Wrote {args.out_dir / (stem + '.json')} and {args.out_dir / (stem + '.md')}")
    return status


if __name__ == "__main__":
    sys.exit(main())
