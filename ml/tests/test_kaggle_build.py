"""
Module: test_kaggle_build.py
Purpose: Tests for ml/kaggle/build_dataset.py (tier A filtering, ignore-region painting that never touches
         labelled objects, the stage-A/B dataset layout) and ml/kaggle/t7_session.py (dataset discovery).
"""

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType

import cv2
import numpy as np
import pytest
import yaml

KAGGLE_DIR = Path(__file__).resolve().parent.parent / "kaggle"


def load(name: str) -> ModuleType:
    """
    Import a script from ml/kaggle by file path (the folder is not a package).

    Args:
        name: Module file stem.
    Returns:
        The loaded module.
    """
    spec = importlib.util.spec_from_file_location(name, KAGGLE_DIR / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


build_dataset = load("build_dataset")
t7_session = load("t7_session")


def test_tier_a_lines_drop_tier_b_classes() -> None:
    """Ids below the tier A count are kept, tier B ids (14+) are dropped, blank lines vanish."""
    text = "0 0.5 0.5 0.1 0.1\n14 0.2 0.2 0.1 0.1\n\n13 0.3 0.3 0.1 0.1\n"
    assert build_dataset.tier_a_lines(text, 14) == ["0 0.5 0.5 0.1 0.1", "13 0.3 0.3 0.1 0.1"]


def test_paint_regions_fills_with_paper_and_protects_labels() -> None:
    """An ignore region becomes paper-coloured, except where it overlaps a labelled box."""
    image = np.full((100, 100, 3), 240, dtype=np.uint8)
    image[20:40, 20:40] = 10  # ink of an object we could not label
    image[30:40, 30:40] = 50  # ink of a labelled object overlapping the region
    painted = build_dataset.paint_regions(image, [[20, 20, 40, 40]], [(32, 32, 40, 40)])
    assert painted == 1
    assert (image[20:28, 20:28] == 240).all()
    assert (image[34:40, 34:40] == 50).all()


def test_build_writes_stage_layouts(tmp_path: Path) -> None:
    """A tiny synthetic + real pair builds both yamls, prefixes synthetic names and keeps real labels tier A only."""
    synth = tmp_path / "synth"
    real = tmp_path / "real"
    for split in ("train", "valid", "test"):
        for root, stem in ((synth, "000001"), (real, "cghd_x")):
            (root / "images" / split).mkdir(parents=True)
            (root / "labels" / split).mkdir(parents=True)
            cv2.imwrite(str(root / "images" / split / f"{stem}.jpg"), np.full((60, 80, 3), 255, dtype=np.uint8))
            (root / "labels" / split / f"{stem}.txt").write_text("0 0.5 0.5 0.2 0.2\n15 0.1 0.1 0.1 0.1\n")
    (real / "ignore" / "train").mkdir(parents=True)
    (real / "ignore" / "train" / "cghd_x.json").write_text(json.dumps([{"reason": "uncertain_fet", "xyxy": [0, 0, 10, 10]}]))
    out = tmp_path / "out"
    info = build_dataset.build(synth, real, out, real_max_side=40, stage_b_synth=5)
    assert (out / "synth" / "images" / "train" / "syn_000001.jpg").is_file()
    assert (out / "real" / "labels" / "test" / "cghd_x.txt").read_text() == "0 0.5 0.5 0.2 0.2\n"
    assert max(cv2.imread(str(out / "real" / "images" / "train" / "cghd_x.jpg")).shape[:2]) == 40
    stage_b = yaml.safe_load((out / "stage_b.yaml").read_text())
    assert stage_b["val"] == ["synth/images/valid", "real/images/valid"] and stage_b["test"] == "real/images/test"
    assert (out / "stage_b_synth_train.txt").read_text() == "./synth/images/train/syn_000001.jpg\n"
    assert info["real"]["splits"]["train"]["painted_regions"] == 1
    assert (out / "train_kaggle.py").is_file() and t7_session.find_dataset(tmp_path) == out
    with pytest.raises(FileExistsError):
        build_dataset.build(synth, real, out, 40, 5)
