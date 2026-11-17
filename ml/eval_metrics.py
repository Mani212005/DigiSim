"""
Module: eval_metrics.py
Purpose: Pure (model-free) detection metrics for the evaluation harness: Wilson confidence
         intervals, greedy IoU matching of predictions to ground truth, a confusion matrix
         accumulator, per-class precision/recall/F1/accuracy records, per-domain splits and
         small-object (junction) recall. Kept free of ultralytics/torch so it is unit-testable.

Conventions:
    - Boxes are pixel xyxy. Ground truth rows are [cls, x1, y1, x2, y2]; prediction rows are
      [cls, conf, x1, y1, x2, y2]. A prediction class of -1 means "not in the dataset vocabulary".
    - The confusion matrix has rows = predicted class and columns = ground-truth class, with the
      extra last index meaning background: [background, gt] is a miss (false negative) and
      [pred, background] is a spurious detection (false positive). This matches ultralytics.
    - "accuracy" keeps the repo's definition (TP / ground-truth instances of the class), the
      number the phase gate in agent_docs/ml-pipeline.md uses; it equals recall.
"""

import math
import re
from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np

# Rows with fewer ground-truth instances than this are flagged "low support" in reports.
LOW_SUPPORT_N = 30
# Default longest-side threshold (original-image pixels) below which a GT box counts as small.
# Junction dots are 10-17 px at ~1000 px width (agent_docs/ml-pipeline.md / run notes).
DEFAULT_SMALL_PX = 24.0
IOU_MATCH_THRESHOLD = 0.5

# Filename-prefix rules mapping an image to its data domain. First match wins.
DEFAULT_DOMAIN_RULES: tuple[tuple[str, str], ...] = (
    ("syn_", "synthetic"),
    ("rf_", "roboflow_real"),
    ("cghd_", "cghd_real"),
    ("dss_", "digisim_screenshot"),
)
UNKNOWN_DOMAIN = "unknown"


def wilson_interval(successes: int, total: int, z: float = 1.96) -> tuple[float, float] | None:
    """
    Wilson score interval for a binomial proportion.

    Args:
        successes: Number of successes (0 <= successes <= total).
        total: Number of trials.
        z: Normal quantile (1.96 for a 95% interval).
    Returns:
        (low, high) bounds in [0, 1], or None when total is 0.
    Raises:
        ValueError: If successes is outside [0, total].
    """
    if total < 0 or successes < 0 or successes > total:
        raise ValueError(f"Invalid counts: {successes}/{total}")
    if total == 0:
        return None
    p = successes / total
    denom = 1.0 + z * z / total
    centre = (p + z * z / (2 * total)) / denom
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def rate(successes: int, total: int) -> dict[str, object]:
    """
    A proportion with its Wilson 95% interval, JSON-ready.

    Args:
        successes: Numerator.
        total: Denominator.
    Returns:
        Dict with value (None when total is 0), ci95 ([low, high] or None) and n (the denominator).
    """
    ci = wilson_interval(successes, total)
    return {
        "value": successes / total if total else None,
        "ci95": [round(ci[0], 6), round(ci[1], 6)] if ci else None,
        "n": total,
    }


def domain_for(image_name: str, rules: Sequence[tuple[str, str]] = DEFAULT_DOMAIN_RULES) -> str:
    """
    Resolve an image file name to its data domain by filename prefix.

    Args:
        image_name: Image file name (or stem).
        rules: Ordered (prefix, domain) pairs; first match wins.
    Returns:
        The domain name, or UNKNOWN_DOMAIN when no prefix matches.
    """
    for prefix, domain in rules:
        if image_name.startswith(prefix):
            return domain
    return UNKNOWN_DOMAIN


def parse_domain_rule(text: str) -> tuple[str, str]:
    """
    Parse a CLI `PREFIX=DOMAIN` rule.

    Args:
        text: The raw argument, e.g. "cghd_=cghd_real".
    Returns:
        (prefix, domain).
    Raises:
        ValueError: If the text is not of the form PREFIX=DOMAIN with both parts non-empty.
    """
    prefix, sep, domain = text.partition("=")
    if not sep or not prefix or not re.fullmatch(r"[A-Za-z0-9_.-]+", domain):
        raise ValueError(f"Domain rule must look like PREFIX=domain_name, got {text!r}")
    return prefix, domain


def box_iou(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """
    Pairwise IoU between two sets of xyxy boxes.

    Args:
        a: (n, 4) array of boxes.
        b: (m, 4) array of boxes.
    Returns:
        (n, m) IoU matrix (0 where the union is empty).
    """
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)), dtype=np.float64)
    a = a.astype(np.float64)
    b = b.astype(np.float64)
    ix1 = np.maximum(a[:, None, 0], b[None, :, 0])
    iy1 = np.maximum(a[:, None, 1], b[None, :, 1])
    ix2 = np.minimum(a[:, None, 2], b[None, :, 2])
    iy2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(ix2 - ix1, 0, None) * np.clip(iy2 - iy1, 0, None)
    area_a = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1])
    area_b = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    union = area_a[:, None] + area_b[None, :] - inter
    return np.where(union > 0, inter / np.where(union > 0, union, 1.0), 0.0)


def match_boxes(gt: np.ndarray, pred: np.ndarray, iou_threshold: float = IOU_MATCH_THRESHOLD) -> list[tuple[int, int]]:
    """
    One-to-one greedy matching of predictions to ground truth by descending IoU (class-agnostic).

    Args:
        gt: (n, 5) rows [cls, x1, y1, x2, y2].
        pred: (m, 6) rows [cls, conf, x1, y1, x2, y2].
        iou_threshold: Minimum IoU for a pair to be considered.
    Returns:
        List of (gt_index, pred_index) pairs.
    """
    if len(gt) == 0 or len(pred) == 0:
        return []
    iou = box_iou(gt[:, 1:5], pred[:, 2:6])
    gi, pi = np.nonzero(iou >= iou_threshold)
    if len(gi) == 0:
        return []
    # Highest IoU first; ties broken by higher prediction confidence.
    order = np.lexsort((-pred[pi, 1], -iou[gi, pi]))
    used_gt: set[int] = set()
    used_pred: set[int] = set()
    pairs: list[tuple[int, int]] = []
    for k in order:
        g, p = int(gi[k]), int(pi[k])
        if g in used_gt or p in used_pred:
            continue
        used_gt.add(g)
        used_pred.add(p)
        pairs.append((g, p))
    return pairs


@dataclass
class DetectionAccumulator:
    """Accumulates the confusion matrix and small-object counters over many images."""

    n_classes: int
    small_px: float = DEFAULT_SMALL_PX
    iou_threshold: float = IOU_MATCH_THRESHOLD
    matrix: np.ndarray = field(init=False)
    n_images: int = 0
    small_total: int = 0
    small_hits: int = 0
    unmapped_predictions: int = 0

    def __post_init__(self) -> None:
        """
        Allocate the (n_classes + 1) square confusion matrix.
        """
        self.matrix = np.zeros((self.n_classes + 1, self.n_classes + 1), dtype=np.int64)

    def add_image(self, gt: np.ndarray, pred: np.ndarray) -> None:
        """
        Match one image's predictions to its ground truth and update every counter.

        Args:
            gt: (n, 5) rows [cls, x1, y1, x2, y2] (cls in [0, n_classes)).
            pred: (m, 6) rows [cls, conf, x1, y1, x2, y2] already filtered by the operating confidence;
                cls of -1 marks a class outside the dataset vocabulary.
        Raises:
            ValueError: If a ground-truth class id is out of range.
        """
        bg = self.n_classes
        self.n_images += 1
        if len(gt) and (gt[:, 0].min() < 0 or gt[:, 0].max() >= bg):
            raise ValueError("Ground-truth class id out of range for this vocabulary")
        pairs = match_boxes(gt, pred, self.iou_threshold)
        matched_gt = {g for g, _ in pairs}
        matched_pred = {p for _, p in pairs}
        small = (np.maximum(gt[:, 3] - gt[:, 1], gt[:, 4] - gt[:, 2]) <= self.small_px) if len(gt) else np.zeros(0, dtype=bool)
        for g, p in pairs:
            gcls, pcls = int(gt[g, 0]), int(pred[p, 0])
            if pcls < 0:
                self.matrix[bg, gcls] += 1  # matched by an out-of-vocabulary prediction: the GT is missed
            else:
                self.matrix[pcls, gcls] += 1
                if small[g] and pcls == gcls:
                    self.small_hits += 1
        for g in range(len(gt)):
            if g not in matched_gt:
                self.matrix[bg, int(gt[g, 0])] += 1
        for p in range(len(pred)):
            if p in matched_pred:
                continue
            pcls = int(pred[p, 0])
            if pcls < 0:
                self.unmapped_predictions += 1
            else:
                self.matrix[pcls, bg] += 1
        self.small_total += int(small.sum())

    def per_class(self, names: Sequence[str]) -> dict[str, dict[str, object]]:
        """
        Per-class counts and metrics with Wilson CIs.

        Args:
            names: Class names ordered by class id.
        Returns:
            Mapping class name -> record with gt, tp, fp, fn, precision, recall, accuracy, f1, low_support.
        """
        out: dict[str, dict[str, object]] = {}
        for c, name in enumerate(names):
            tp = int(self.matrix[c, c])
            fp = int(self.matrix[c, :].sum()) - tp
            gt_n = int(self.matrix[:, c].sum())
            fn = gt_n - tp
            out[name] = {
                "gt": gt_n,
                "tp": tp,
                "fp": fp,
                "fn": fn,
                "precision": rate(tp, tp + fp),
                "recall": rate(tp, gt_n),
                "accuracy": rate(tp, gt_n),
                "f1": f1_record(tp, fp, fn),
                "low_support": gt_n < LOW_SUPPORT_N,
            }
        return out

    def overall(self) -> dict[str, object]:
        """
        Micro-averaged metrics over all classes plus the small-object recall.

        Returns:
            Record with images, gt, tp, fp, fn, precision, recall, f1 and small_object.
        """
        bg = self.n_classes
        tp = int(np.trace(self.matrix[:bg, :bg]))
        fp = int(self.matrix[:bg, :].sum()) - tp
        gt_n = int(self.matrix[:, :bg].sum())
        fn = gt_n - tp
        return {
            "images": self.n_images,
            "gt": gt_n,
            "tp": tp,
            "fp": fp,
            "fn": fn,
            "precision": rate(tp, tp + fp),
            "recall": rate(tp, gt_n),
            "f1": f1_record(tp, fp, fn),
            "unmapped_predictions": self.unmapped_predictions,
            "small_object": {
                "max_side_px": self.small_px,
                "recall": rate(self.small_hits, self.small_total),
            },
        }

    def confusion(self, names: Sequence[str]) -> dict[str, object]:
        """
        The confusion matrix with labels, rows = predicted, columns = ground truth.

        Args:
            names: Class names ordered by class id.
        Returns:
            Dict with labels (names + "background"), axes description and the integer matrix.
        """
        return {
            "labels": [*names, "background"],
            "rows": "predicted",
            "columns": "ground_truth",
            "matrix": self.matrix.tolist(),
        }


def f1_record(tp: int, fp: int, fn: int) -> dict[str, object]:
    """
    F1 with an approximate Wilson interval.

    F1 = 2TP / (2TP + FP + FN) is treated as a proportion over 2TP + FP + FN pseudo-trials, so the
    interval is a heuristic (it ignores the correlation between precision and recall) but it shrinks
    with support the same way the other intervals do.

    Args:
        tp: True positives.
        fp: False positives.
        fn: False negatives.
    Returns:
        Dict with value, ci95 and n (as in rate()).
    """
    return rate(2 * tp, 2 * tp + fp + fn)
