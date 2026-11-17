"""
Module: test_eval_metrics.py
Purpose: Unit tests for ml/eval_metrics.py - Wilson intervals, IoU matching, the confusion matrix
         accumulator, per-class records, small-object recall and domain resolution.
"""

import numpy as np
import pytest

from eval_metrics import DetectionAccumulator, box_iou, domain_for, match_boxes, parse_domain_rule, rate, wilson_interval


def gt_rows(*rows: tuple[int, float, float, float, float]) -> np.ndarray:
    """
    Build a ground-truth array.

    Args:
        rows: (cls, x1, y1, x2, y2) tuples.
    Returns:
        (n, 5) float array.
    """
    return np.asarray(rows, dtype=float).reshape(-1, 5)


def pred_rows(*rows: tuple[int, float, float, float, float, float]) -> np.ndarray:
    """
    Build a prediction array.

    Args:
        rows: (cls, conf, x1, y1, x2, y2) tuples.
    Returns:
        (m, 6) float array.
    """
    return np.asarray(rows, dtype=float).reshape(-1, 6)


def test_wilson_matches_reference_values() -> None:
    """Known Wilson 95% intervals: 8/10, 0/10, 10/10."""
    lo, hi = wilson_interval(8, 10)
    assert lo == pytest.approx(0.4902, abs=1e-3) and hi == pytest.approx(0.9433, abs=1e-3)
    lo, hi = wilson_interval(0, 10)
    assert lo == 0.0 and hi == pytest.approx(0.2775, abs=1e-3)
    lo, hi = wilson_interval(10, 10)
    assert hi == 1.0 and lo == pytest.approx(0.7225, abs=1e-3)


def test_wilson_edge_cases() -> None:
    """Empty denominators give no interval; invalid counts raise."""
    assert wilson_interval(0, 0) is None
    assert rate(0, 0) == {"value": None, "ci95": None, "n": 0}
    with pytest.raises(ValueError):
        wilson_interval(5, 3)


def test_box_iou_and_match_is_one_to_one() -> None:
    """Identical boxes have IoU 1; a duplicate prediction cannot match the same GT twice."""
    a = np.array([[0, 0, 10, 10]], dtype=float)
    assert box_iou(a, a)[0, 0] == pytest.approx(1.0)
    gt = gt_rows((0, 0, 0, 10, 10))
    preds = pred_rows((0, 0.9, 0, 0, 10, 10), (0, 0.8, 1, 1, 10, 10))
    assert match_boxes(gt, preds) == [(0, 0)]
    assert match_boxes(gt, pred_rows()) == []


def test_accumulator_counts_hits_misses_confusions_and_spurious() -> None:
    """One TP, one misclassification, one miss and one spurious detection land in the right cells."""
    acc = DetectionAccumulator(n_classes=2)
    gt = gt_rows((0, 0, 0, 20, 20), (1, 100, 100, 140, 140), (1, 200, 200, 240, 240))
    preds = pred_rows(
        (0, 0.9, 0, 0, 20, 20),  # correct class 0
        (0, 0.8, 100, 100, 140, 140),  # class 1 object predicted as 0
        (1, 0.7, 400, 400, 440, 440),  # spurious class 1
    )
    acc.add_image(gt, preds)
    # rows = predicted (0, 1, background), cols = ground truth (0, 1, background)
    assert acc.matrix.tolist() == [[1, 1, 0], [0, 0, 1], [0, 1, 0]]
    per_class = acc.per_class(["A", "B"])
    assert per_class["A"]["tp"] == 1 and per_class["A"]["fp"] == 1 and per_class["A"]["fn"] == 0
    assert per_class["B"]["gt"] == 2 and per_class["B"]["fn"] == 2 and per_class["B"]["fp"] == 1
    assert per_class["B"]["recall"]["value"] == 0.0 and per_class["B"]["accuracy"]["value"] == 0.0
    assert per_class["A"]["low_support"] is True


def test_small_object_recall_and_unmapped_predictions() -> None:
    """Only boxes with longest side <= small_px count as small; class -1 predictions are tracked, not scored as a class."""
    acc = DetectionAccumulator(n_classes=1, small_px=12)
    gt = gt_rows((0, 0, 0, 10, 10), (0, 50, 50, 90, 90))
    preds = pred_rows((0, 0.9, 0, 0, 10, 10), (-1, 0.9, 50, 50, 90, 90), (-1, 0.5, 300, 300, 320, 320))
    acc.add_image(gt, preds)
    overall = acc.overall()
    assert overall["small_object"]["recall"]["n"] == 1 and overall["small_object"]["recall"]["value"] == 1.0
    assert overall["unmapped_predictions"] == 1  # the unmatched one
    assert acc.per_class(["A"])["A"]["fn"] == 1  # the big box was "matched" by an out-of-vocabulary prediction: still a miss


def test_out_of_range_ground_truth_class_raises() -> None:
    """A GT class id outside the vocabulary is a data error."""
    acc = DetectionAccumulator(n_classes=2)
    with pytest.raises(ValueError):
        acc.add_image(gt_rows((5, 0, 0, 1, 1)), pred_rows())


def test_domains() -> None:
    """Prefix rules resolve domains; custom rules parse and malformed ones are rejected."""
    assert domain_for("syn_test_00001.jpg") == "synthetic"
    assert domain_for("rf_x.jpg") == "roboflow_real"
    assert domain_for("mystery.jpg") == "unknown"
    assert parse_domain_rule("cghd_=cghd_real") == ("cghd_", "cghd_real")
    with pytest.raises(ValueError):
        parse_domain_rule("nonsense")
