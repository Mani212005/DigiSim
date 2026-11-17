"""
Module: test_evaluate.py
Purpose: Tests for ml/evaluate.py helpers and CLI behaviour that need no trained weights: label
         parsing, class-name mapping (incl. legacy aliases), the reproduction check, the markdown
         renderer, and the refusal to run when the frozen test set changed. The CLI runs use a stub
         detector (no weights, no ultralytics) and --skip-legacy; the frozen check, netlist scoring and
         report writing around it are the real code.
"""

import json
from pathlib import Path

import numpy as np
import pytest
from conftest import nand_netlist
from test_eval_frozen import make_dataset

import evaluate
from eval_metrics import DetectionAccumulator
from eval_report import render_markdown
from evaluate import DatasetInfo, build_class_map, load_dataset_info, main, read_labels, reproduction_check, sibling_dir

DETECTOR_CALLS: list[Path] = []


def stub_detection(info: DatasetInfo, weights: Path, imgsz: int, conf: float, iou: float, small_px: float, device: str, domain_rules: tuple[tuple[str, str], ...]) -> dict:
    """
    Stand-in for evaluate_detection: an empty but schema-complete detection block, recording that it ran.

    Args:
        info: Resolved dataset.
        weights: Weights path (unused).
        imgsz: Inference size (unused).
        conf: Operating confidence.
        iou: IoU threshold.
        small_px: Small-object threshold.
        device: Device (unused).
        domain_rules: Domain rules (unused).
    Returns:
        A detection dict with no ground truth and no predictions.
    """
    DETECTOR_CALLS.append(weights)
    acc = DetectionAccumulator(len(info.names), small_px, iou)
    per_class = acc.per_class(info.names)
    return {
        "conf": conf,
        "iou_threshold": iou,
        "model_classes": list(info.names),
        "class_map": {},
        "overall": acc.overall(),
        "per_class": per_class,
        "per_domain": {},
        "confusion_matrix": acc.confusion(info.names),
        "junction_recall": None,
    }


@pytest.fixture(autouse=True)
def stub_detector(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replace the model-backed detector so CLI runs need no weights."""
    DETECTOR_CALLS.clear()
    monkeypatch.setattr(evaluate, "evaluate_detection", stub_detection)


def test_read_labels_handles_boxes_polygons_and_missing_files(tmp_path: Path) -> None:
    """YOLO boxes and polygons become pixel xyxy; a missing file is empty ground truth."""
    label = tmp_path / "a.txt"
    label.write_text("2 0.5 0.5 0.2 0.4\n1 0.1 0.1 0.3 0.1 0.3 0.5 0.1 0.5\n\n")
    rows = read_labels(label, 100, 200)
    assert rows.shape == (2, 5)
    assert rows[0].tolist() == pytest.approx([2, 40, 60, 60, 140])
    assert rows[1].tolist() == pytest.approx([1, 10, 20, 30, 100])
    assert read_labels(tmp_path / "none.txt", 10, 10).shape == (0, 5)
    label.write_text("1 0.1 0.2\n")
    with pytest.raises(ValueError):
        read_labels(label, 10, 10)


def test_class_map_by_name_then_alias() -> None:
    """Names match directly; legacy aliases resolve to the canonical dataset class; unknown classes map to -1."""
    aliases = {"SWITCH": "INPUT_PORT", "LED": "OUTPUT_PORT"}
    mapping = build_class_map({0: "NMOS", 1: "SWITCH", 2: "LED", 3: "mystery"}, ("NMOS", "INPUT_PORT", "OUTPUT_PORT"), aliases)
    assert mapping == [0, 1, 2, -1]
    assert build_class_map({0: "SWITCH"}, ("SWITCH", "INPUT_PORT"), aliases) == [0]  # an exact name beats the alias


def test_reproduction_check_tolerance() -> None:
    """Within tolerance passes, beyond it fails, and a metric missing from the run counts as a failure."""
    legacy = {"map50": 0.99, "map50_95": 0.95, "per_class": {"A": {"f1": 0.97, "accuracy": 0.96}}}
    ref = {"map50": 0.992, "map50_95": 0.949, "per_class": {"A": {"f1": 0.9705, "accuracy": 0.96}}}
    assert reproduction_check(legacy, ref, 0.01, "ref")["ok"] is True
    assert reproduction_check(legacy, ref, 0.0001, "ref")["ok"] is False
    ref["per_class"]["B"] = {"f1": 0.9}
    assert reproduction_check(legacy, ref, 0.5, "ref")["ok"] is False


def write_yaml(root: Path) -> Path:
    """
    Write a data.yaml for the tiny test dataset.

    Args:
        root: Dataset root.
    Returns:
        The yaml path.
    """
    data = root / "data.yaml"
    data.write_text(f"path: {root}\ntrain: images/test\nval: images/test\ntest: images/test\nnames: [A, B]\n")
    return data


def test_cli_refuses_changed_frozen_set_and_requires_a_name(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """freeze -> verified run works; editing a label makes the run exit 3 with no report; the test split needs --frozen-name."""
    root = make_dataset(tmp_path / "d")
    data = write_yaml(root)
    registry = tmp_path / "frozen.json"
    out = tmp_path / "out"
    common = ["--data", str(data), "--registry", str(registry), "--out-dir", str(out), "--skip-legacy"]
    with pytest.raises(SystemExit):
        main([*common])  # test split without --frozen-name
    assert main([*common, "--frozen-name", "t", "--freeze", "--freeze-note", "tiny"]) == 0
    assert main([*common, "--frozen-name", "t"]) == 0
    assert main(common) == 0  # name inferred: one registered set has this split and class list
    report = json.loads((out / "t.json").read_text())
    assert report["run"]["dataset"]["sha256"] == json.loads(registry.read_text())["t"]["sha256"]
    (out / "t.json").unlink()
    (root / "labels" / "test" / "syn_0.txt").write_text("1 0.5 0.5 0.1 0.1\n")
    detector_runs = len(DETECTOR_CALLS)
    assert main([*common, "--frozen-name", "t"]) == 3
    assert len(DETECTOR_CALLS) == detector_runs
    assert not (out / "t.json").exists()
    assert "refusing to evaluate" in capsys.readouterr().err


def test_end_to_end_report_renders_markdown(tmp_path: Path) -> None:
    """A run with netlists writes JSON plus a Markdown table with the three end-to-end headline metrics."""
    root = make_dataset(tmp_path / "d")
    (root / "netlists" / "test").mkdir(parents=True)
    (root / "netlists" / "test" / "syn_0.json").write_text(json.dumps(nand_netlist(with_boxes=True)))
    pred = tmp_path / "pred"
    pred.mkdir()
    (pred / "syn_0.json").write_text(json.dumps(nand_netlist(with_boxes=True, prefix="p_", shift=1.0)))
    data, out = write_yaml(root), tmp_path / "out"
    args = ["--data", str(data), "--registry", str(tmp_path / "f.json"), "--out-dir", str(out), "--skip-legacy", "--frozen-name", "t"]
    assert main([*args, "--freeze"]) == 0
    assert main([*args, "--gt-netlists", str(root / "netlists" / "test"), "--pred-netlists", str(pred), "--no-truth-table"]) == 0
    markdown = (out / "t.md").read_text()
    assert "End-to-end (netlist)" in markdown and "exact match" in markdown
    report = json.loads((out / "t.json").read_text())
    assert report["end_to_end"]["overall"]["net_micro"]["f1"] == 1.0
    assert render_markdown(report, report).count("# DigiSim evaluation") == 1
    assert np.isclose(report["end_to_end"]["overall"]["exact_match"]["value"], 1.0)


def test_frozen_hash_covers_the_directories_data_yaml_names(tmp_path: Path) -> None:
    """A split entry that is not images/<split> is hashed where it points: editing that directory is refused."""
    root = tmp_path / "d"
    (root / "images" / "test_v2").mkdir(parents=True)
    (root / "labels" / "test_v2").mkdir(parents=True)
    (root / "images" / "test_v2" / "syn_0.jpg").write_bytes(b"image-bytes")
    (root / "labels" / "test_v2" / "syn_0.txt").write_text("0 0.5 0.5 0.1 0.1\n")
    data = root / "data.yaml"
    data.write_text(f"path: {root}\ntrain: images/test_v2\nval: images/test_v2\ntest: images/test_v2\nnames: [A, B]\n")
    info = load_dataset_info(data, "test")
    assert info.netlists_dir == root / "netlists" / "test_v2"
    registry = tmp_path / "frozen.json"
    common = ["--data", str(data), "--registry", str(registry), "--out-dir", str(tmp_path / "out"), "--skip-legacy", "--frozen-name", "t"]
    assert main([*common, "--freeze"]) == 0
    assert main(common) == 0
    (root / "labels" / "test_v2" / "syn_0.txt").write_text("1 0.5 0.5 0.1 0.1\n")
    assert main(common) == 3


def test_frozen_hash_covers_the_scored_ground_truth_netlists(tmp_path: Path) -> None:
    """--gt-netlists pointing outside the dataset is hashed too: a different ground truth is refused."""
    root = make_dataset(tmp_path / "d")
    gt = tmp_path / "gt"
    gt.mkdir()
    (gt / "syn_0.json").write_text(json.dumps(nand_netlist(with_boxes=True)))
    pred = tmp_path / "pred"
    pred.mkdir()
    (pred / "syn_0.json").write_text(json.dumps(nand_netlist(with_boxes=True)))
    data, out = write_yaml(root), tmp_path / "out"
    base = ["--data", str(data), "--registry", str(tmp_path / "f.json"), "--out-dir", str(out), "--skip-legacy", "--frozen-name", "t"]
    scored = [*base, "--gt-netlists", str(gt), "--pred-netlists", str(pred), "--no-truth-table"]
    assert main([*scored, "--freeze"]) == 0
    assert main(scored) == 0
    (gt / "syn_0.json").write_text(json.dumps(nand_netlist(with_boxes=True, shift=2.0)))
    assert main(scored) == 3


def test_end_to_end_domains_follow_cli_domain_rules(tmp_path: Path) -> None:
    """--domain-rule groups the end-to-end per-domain block, not only the detection one."""
    root = make_dataset(tmp_path / "d")
    gt, pred = tmp_path / "gt", tmp_path / "pred"
    for folder in (gt, pred):
        folder.mkdir()
        for stem in ("syn_0", "foo_1"):
            (folder / f"{stem}.json").write_text(json.dumps(nand_netlist(with_boxes=True)))
    out = tmp_path / "out"
    args = ["--data", str(write_yaml(root)), "--registry", str(tmp_path / "f.json"), "--out-dir", str(out), "--skip-legacy", "--frozen-name", "t"]
    scored = [*args, "--gt-netlists", str(gt), "--pred-netlists", str(pred), "--no-truth-table", "--domain-rule", "foo_=bar"]
    assert main([*scored, "--freeze"]) == 0
    assert main(scored) == 0
    report = json.loads((out / "t.json").read_text())
    assert set(report["end_to_end"]["per_domain"]) == {"synthetic", "bar"}


def test_report_marks_an_unfrozen_split_unverified(tmp_path: Path) -> None:
    """A split with no registered frozen set runs unchecked, and the Markdown says so instead of claiming verification."""
    root = make_dataset(tmp_path / "d")
    out = tmp_path / "out"
    unfrozen = ["--data", str(write_yaml(root)), "--registry", str(tmp_path / "f.json"), "--out-dir", str(out), "--skip-legacy", "--split", "val"]
    assert main(unfrozen) == 0
    assert "(not frozen - unverified)" in (out / "d_val.md").read_text()
    assert "(verified)" not in (out / "d_val.md").read_text()
    frozen = [*unfrozen[:-2], "--frozen-name", "t"]
    assert main([*frozen, "--freeze"]) == 0
    assert main(frozen) == 0
    assert "(verified)" in (out / "t.md").read_text()


def test_labels_and_netlists_dirs_swap_the_last_images_component(tmp_path: Path) -> None:
    """Like ultralytics, only the last 'images' path component is replaced, so an 'images' earlier in the path stays."""
    assert sibling_dir(Path("/a/images/ds/images/test"), "labels") == Path("/a/images/ds/labels/test")
    root = tmp_path / "my_images"
    (root / "images" / "test").mkdir(parents=True)
    data = root / "data.yaml"
    data.write_text(f"path: {root}\ntest: images/test\nnames: [A, B]\n")
    info = load_dataset_info(data, "test")
    assert info.labels_dir == root / "labels" / "test"
    assert info.netlists_dir == root / "netlists" / "test"
    with pytest.raises(ValueError):
        sibling_dir(Path("/data/test"), "labels")
