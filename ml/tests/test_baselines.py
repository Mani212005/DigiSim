"""
Module: test_baselines.py
Purpose: Guards the committed evaluation baselines: ml/baselines/gate12.json must reference a frozen set
         that is registered in ml/frozen_sets.json with the same hash and class list, must have reproduced
         the old numbers within tolerance, and must carry the per-class and per-domain detection blocks
         later runs are compared against.
"""

import json
from pathlib import Path

import pytest

ML_DIR = Path(__file__).resolve().parents[1]
BASELINE = ML_DIR / "baselines" / "gate12.json"


@pytest.fixture(scope="module")
def baseline() -> dict:
    """
    The committed gate12 baseline report.

    Returns:
        Parsed JSON.
    """
    return json.loads(BASELINE.read_text())


def test_gate12_baseline_matches_the_frozen_registry(baseline: dict) -> None:
    """The baseline's dataset hash and classes are exactly what ml/frozen_sets.json froze."""
    registry = json.loads((ML_DIR / "frozen_sets.json").read_text())
    dataset = baseline["run"]["dataset"]
    entry = registry[dataset["frozen_name"]]
    assert entry["sha256"] == dataset["sha256"]
    assert entry["classes"] == dataset["classes"]
    assert entry["images"] == dataset["images"] == 78


def test_gate12_baseline_reproduced_the_old_numbers(baseline: dict) -> None:
    """The old validation numbers were reproduced within tolerance, and the new blocks are present."""
    assert baseline["reproduction"]["ok"] is True
    assert baseline["reproduction"]["max_abs_delta"] <= baseline["reproduction"]["tolerance"]
    detection = baseline["detection"]
    assert set(detection["per_class"]) == set(baseline["run"]["dataset"]["classes"])
    assert {"synthetic", "roboflow_real"} <= set(detection["per_domain"])
    assert detection["junction_recall"]["value"] == pytest.approx(0.957, abs=0.001)
    assert baseline["run"]["weights"]["sha256"] and baseline["baseline"]["weights"].startswith("not committed")
