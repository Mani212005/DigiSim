"""
Module: test_real_data.py
Purpose: Unit tests for the real-data ingestion (T4): label conversion and class remap, terminal text
         triage, transistor polarity propagation, the split hashes and the leakage verifier, plus a check
         that the committed manifest is leak-free and consistent with its own hashes.
"""

import json
from pathlib import Path

import pytest

from class_schema import load_schema
from real_data import config
from real_data.build import manifest_records, parse_pilot, to_yolo_rows, verify
from real_data.cghd import LabelBox, VocAnnotation, VocObject, convert_annotation, nearest_text, parse_voc
from real_data.class_remap import CGHD_DIRECT, ROBOFLOW_NAMES, classify_terminal, validate_remaps
from real_data.fet_polarity import drawing_of, match_fets, propagate_polarity
from real_data.report import FLAG_TOO_LOW, class_flags
from real_data.roboflow import polygon_to_box, roboflow_source_name
from real_data.splits import ImageRecord, hamming, split_hash, verify_no_leakage


def _obj(index: int, name: str, box: tuple[float, float, float, float], text: str | None = None) -> VocObject:
    """
    Build a VocObject for a test.

    Args:
        index: Object index.
        name: CGHD class name.
        box: (xmin, ymin, xmax, ymax).
        text: Optional label text.
    Returns:
        The object.
    """
    return VocObject(index, name, *box, None, text)


def _record(name: str, split: str, group: str, source_id: str, sha: str, dh: str) -> ImageRecord:
    """
    Build an ImageRecord for a test.

    Args:
        name: Image name.
        split: Split name.
        group: Leakage group.
        source_id: Source image id.
        sha: Content hash stand-in.
        dh: Difference-hash stand-in (16 hex digits).
    Returns:
        The record.
    """
    return ImageRecord(name, split, "cghd", group, source_id, sha, "l" + name, dh, 100, 100)


def test_remaps_point_at_real_classes() -> None:
    """Every remap target exists in classes.yaml."""
    validate_remaps(load_schema())
    assert set(CGHD_DIRECT.values()) <= set(load_schema().names)
    assert set(ROBOFLOW_NAMES.values()) <= set(load_schema().names)


def test_polygon_to_box_handles_polygons_and_plain_boxes() -> None:
    """A 7-point polygon collapses to its extent; a 4-value row is a centre/size box."""
    assert polygon_to_box([0.2, 0.3, 0.4, 0.1, 0.3, 0.5]) == (0.2, 0.1, 0.4, 0.5)
    assert polygon_to_box([0.5, 0.5, 0.2, 0.4]) == pytest.approx((0.4, 0.3, 0.6, 0.7))
    with pytest.raises(ValueError):
        polygon_to_box([0.1, 0.2, 0.3])
    with pytest.raises(ValueError):
        polygon_to_box([0.1, 0.2, 0.3, 0.4, 0.5])


def test_roboflow_source_name() -> None:
    """The Roboflow hash suffix is stripped back to the Sampleimages name."""
    assert roboflow_source_name("eleventh_image_jpg.rf.O7hixbrwyCKa0EUTHYm9.jpg") == "eleventh_image.jpg"
    with pytest.raises(ValueError):
        roboflow_source_name("plain.jpg")


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("A", "INPUT_PORT"),
        ("Vin", "INPUT_PORT"),
        ("CLK", "INPUT_PORT"),
        ("Vout", "OUTPUT_PORT"),
        ("Y", "OUTPUT_PORT"),
        ("Q", "OUTPUT_PORT"),
        ("VDD", "VDD"),
        ("+5V", "VDD"),
        ("12 V", "VDD"),
        ("0V", "GND"),
        ("0v", "GND"),
        ("0.0V", "GND"),
        ("+0V", "GND"),
        ("0", "GND"),
        ("230V", None),
        ("R1", None),
        ("Q1", None),
        ("GND", "GND"),
        ("10k", None),
        ("", None),
        (None, None),
    ],
)
def test_classify_terminal(text: str | None, expected: str | None) -> None:
    """
    Terminal text decides input/output/supply; anything unclear stays undecided.

    Args:
        text: Label next to the terminal.
        expected: Expected class name, or None when the label must not decide.
    """
    assert classify_terminal(text) == expected


@pytest.mark.parametrize("source_class", ["vss", "voltage.dc"])
def test_supply_symbols_are_resolved_by_text_or_ignored(source_class: str) -> None:
    """
    vss and voltage.dc take their class from the neighbouring label and are ignore regions otherwise.

    Args:
        source_class: CGHD supply class under test.
    """
    assert source_class not in CGHD_DIRECT

    def convert(label: str | None) -> tuple[list[str], list[tuple[str, str]]]:
        objects = [_obj(0, source_class, (100, 100, 150, 150))]
        if label is not None:
            objects.append(_obj(1, "text", (160, 100, 220, 150), label))
        out = convert_annotation(VocAnnotation("x.jpg", 1000, 1000, tuple(objects)), {}, "drafter_1/x")
        return [b.class_name for b in out.boxes], [(i.reason, i.source_class) for i in out.ignored]

    assert convert("VSS") == (["GND"], [])
    assert convert("0V") == (["GND"], [])
    assert convert("VDD") == (["VDD"], [])
    assert convert("+5V") == (["VDD"], [])
    assert convert("Vin") == ([], [("uncertain_supply", source_class)])
    assert convert("R1") == ([], [("uncertain_supply", source_class)])
    assert convert(None) == ([], [("uncertain_supply", source_class)])


def test_tiny_transistor_does_not_shift_later_polarity_keys() -> None:
    """A sub-minimum transistor is skipped but still consumes its ordinal, so later FETs keep their own decision."""
    ann = VocAnnotation(
        "x.jpg",
        1000,
        1000,
        (
            _obj(0, "transistor.fet", (10, 10, 12, 12)),
            _obj(1, "transistor.fet", (100, 10, 160, 80)),
            _obj(2, "transistor.fet", (200, 10, 260, 80)),
        ),
    )
    polarity = {"drafter_1/x#0": "NMOS", "drafter_1/x#1": "PMOS", "drafter_1/x#2": "NMOS"}
    out = convert_annotation(ann, polarity, "drafter_1/x")
    assert [(b.class_name, b.xmin) for b in out.boxes] == [("PMOS", 100), ("NMOS", 200)]


def test_nearest_text_respects_reach() -> None:
    """Only a label close to the terminal is used."""
    terminal = _obj(0, "terminal", (100, 100, 150, 150))
    near = _obj(1, "text", (160, 100, 220, 150), "Vin")
    far = _obj(2, "text", (900, 900, 960, 950), "Vout")
    assert nearest_text(terminal, [far, near]) == "Vin"
    assert nearest_text(terminal, [far]) is None


def test_convert_annotation_remaps_and_ignores() -> None:
    """Direct classes map, decided FETs and terminals become labels, the rest become ignore regions."""
    objects = (
        _obj(0, "and", (10, 10, 60, 60)),
        _obj(1, "transistor.fet", (100, 10, 160, 80)),
        _obj(2, "transistor.fet", (200, 10, 260, 80)),
        _obj(3, "terminal", (300, 10, 340, 50)),
        _obj(4, "text", (350, 10, 400, 50), "A"),
        _obj(5, "diode", (500, 10, 560, 60)),
        _obj(6, "crossover", (600, 10, 640, 50)),
    )
    ann = VocAnnotation("x.jpg", 1000, 1000, objects)
    polarity = {"drafter_1/x#0": "NMOS", "drafter_1/x#1": "UNCERTAIN"}
    out = convert_annotation(ann, polarity, "drafter_1/x")
    assert [b.class_name for b in out.boxes] == ["AND", "NMOS", "INPUT_PORT"]
    assert sorted((i.reason, i.source_class) for i in out.ignored) == [("uncertain_fet", "transistor.fet"), ("unmapped", "crossover"), ("unmapped", "diode")]


def test_parse_voc_roundtrip(tmp_path: Path) -> None:
    """
    A CGHD-style VOC file parses with rotation and text.

    Args:
        tmp_path: pytest temporary directory.
    """
    xml = tmp_path / "C1_D1_P1.xml"
    xml.write_text(
        "<annotation><filename>C1_D1_P1.jpg</filename><size><width>200</width><height>100</height><depth>3</depth></size>"
        "<object><name>resistor</name><bndbox><xmin>1</xmin><ymin>2</ymin><xmax>30</xmax><ymax>20</ymax><rotation>90</rotation></bndbox></object>"
        "<object><name>text</name><bndbox><xmin>5</xmin><ymin>5</ymin><xmax>9</xmax><ymax>9</ymax></bndbox><text>R1</text></object></annotation>"
    )
    ann = parse_voc(xml)
    assert (ann.width, ann.height) == (200, 100)
    assert ann.objects[0].rotation == 90
    assert ann.objects[1].text == "R1"
    with pytest.raises(FileNotFoundError):
        parse_voc(tmp_path / "missing.xml")


def test_to_yolo_rows_normalises_and_clips() -> None:
    """Rows are normalised to the image and boxes are clipped to its bounds."""
    ids = {"AND": 7}
    rows = to_yolo_rows((LabelBox("AND", 0, 0, 100, 50), LabelBox("AND", -20, -20, 10, 10), LabelBox("AND", 300, 10, 400, 20)), 200, 100, ids)
    assert rows[0] == "7 0.250000 0.250000 0.500000 0.500000"
    assert rows[1] == "7 0.025000 0.050000 0.050000 0.100000"
    assert len(rows) == 2


def test_drawing_of() -> None:
    """The photo number is dropped from the image stem."""
    assert drawing_of("C181_D2_P3") == "C181_D2"
    with pytest.raises(ValueError):
        drawing_of("weird")


def test_polarity_propagates_across_photos_by_position() -> None:
    """Reference decisions follow the transistors to other photos, even when the XML order differs."""
    ref = VocAnnotation("a", 1000, 1000, (_obj(0, "transistor.fet", (100, 100, 140, 140)), _obj(1, "transistor.fet", (700, 100, 740, 140)), _obj(2, "transistor.fet", (100, 800, 140, 840))))
    # Same layout, scaled and shifted, listed in a different order.
    other = VocAnnotation("b", 2000, 2000, (_obj(0, "transistor.fet", (220, 1610, 290, 1680)), _obj(1, "transistor.fet", (1420, 210, 1490, 280)), _obj(2, "transistor.fet", (220, 210, 290, 280))))
    match = match_fets(list(ref.objects), list(other.objects))
    assert match is not None
    assert match.mapping == {0: 2, 1: 1, 2: 0}
    refs = {"drafter_1/C1_D1_P1": {"0": "NMOS", "1": "PMOS", "2": "UNCERTAIN"}}
    labels, residuals = propagate_polarity(refs, {"drafter_1/C1_D1_P1": ref, "drafter_1/C1_D1_P2": other, "drafter_1/C2_D1_P1": ref})
    assert labels["drafter_1/C1_D1_P2#2"] == "NMOS"
    assert labels["drafter_1/C1_D1_P2#1"] == "PMOS"
    assert labels["drafter_1/C1_D1_P2#0"] == "UNCERTAIN"
    assert residuals["drafter_1/C1_D1_P2"] < 0.05
    # A drawing with no reference decision stays undecided.
    assert labels["drafter_1/C2_D1_P1#0"] == "UNCERTAIN"


def test_polarity_rejects_count_mismatch_and_bad_match() -> None:
    """Photos that disagree on the transistor count, or whose layout does not line up, stay UNCERTAIN."""
    two = (_obj(0, "transistor.fet", (0, 0, 10, 10)), _obj(1, "transistor.fet", (500, 500, 510, 510)))
    three = (*two, _obj(2, "transistor.fet", (0, 500, 10, 510)))
    assert match_fets(list(two), list(three)) is None
    anns = {"drafter_1/C1_D1_P1": VocAnnotation("a", 1000, 1000, three), "drafter_1/C1_D1_P2": VocAnnotation("b", 1000, 1000, two)}
    labels, _ = propagate_polarity({"drafter_1/C1_D1_P1": {"0": "NMOS", "1": "PMOS", "2": "NMOS"}}, anns)
    assert labels["drafter_1/C1_D1_P2#0"] == "UNCERTAIN"
    assert labels["drafter_1/C1_D1_P1#1"] == "PMOS"


def test_polarity_requires_same_orientation_for_mixed_drawings() -> None:
    """A rotated photo of a mixed drawing cannot be matched by position, so it stays UNCERTAIN."""
    layout = (_obj(0, "transistor.fet", (100, 100, 140, 140)), _obj(1, "transistor.fet", (700, 100, 740, 140)), _obj(2, "transistor.fet", (100, 800, 140, 840)))
    anns = {"drafter_1/C1_D1_P1": VocAnnotation("a", 1000, 1000, layout), "drafter_1/C1_D1_P2": VocAnnotation("b", 800, 1200, layout)}
    labels, _ = propagate_polarity({"drafter_1/C1_D1_P1": {"0": "NMOS", "1": "PMOS", "2": "PMOS"}}, anns)
    assert labels["drafter_1/C1_D1_P2#0"] == "UNCERTAIN"


def test_polarity_uniform_drawing_needs_no_matching() -> None:
    """When every reference transistor has the same polarity, every photo inherits it even if counts differ."""
    one = (_obj(0, "transistor.fet", (10, 10, 50, 50)),)
    two = (*one, _obj(1, "transistor.fet", (500, 500, 540, 540)))
    anns = {"drafter_1/C1_D1_P1": VocAnnotation("a", 1000, 1000, two), "drafter_1/C1_D1_P2": VocAnnotation("b", 1000, 1000, one)}
    labels, residuals = propagate_polarity({"drafter_1/C1_D1_P1": {"0": "NMOS", "1": "NMOS"}}, anns)
    assert labels == {"drafter_1/C1_D1_P1#0": "NMOS", "drafter_1/C1_D1_P1#1": "NMOS", "drafter_1/C1_D1_P2#0": "NMOS"}
    assert residuals == {}


def test_polarity_validates_reference_decisions() -> None:
    """Reference decisions must name a known image and cover its transistors exactly."""
    ann = VocAnnotation("a", 100, 100, (_obj(0, "transistor.fet", (0, 0, 10, 10)),))
    with pytest.raises(ValueError):
        propagate_polarity({"drafter_9/C1_D1_P1": {"0": "NMOS"}}, {"drafter_1/C1_D1_P1": ann})
    with pytest.raises(ValueError):
        propagate_polarity({"drafter_1/C1_D1_P1": {"0": "NMOS", "1": "PMOS"}}, {"drafter_1/C1_D1_P1": ann})


def test_verify_no_leakage_flags_each_leak_kind() -> None:
    """Group, source image, identical content and near-duplicate leaks are all reported; a clean set passes."""
    a = _record("a", "train", "drafter_1", "cghd/a", "s1", "0000000000000000")
    b = _record("b", "test", "drafter_2", "cghd/b", "s2", "ffffffffffffffff")
    assert verify_no_leakage([a, b]) == []
    assert any("group drafter_1" in p for p in verify_no_leakage([a, _record("c", "test", "drafter_1", "cghd/c", "s3", "ffff0000ffff0000")]))
    assert any("source image cghd/a" in p for p in verify_no_leakage([a, _record("c", "test", "drafter_3", "cghd/a", "s3", "ffff0000ffff0000")]))
    assert any("identical image content s1" in p for p in verify_no_leakage([a, _record("c", "test", "drafter_3", "cghd/c", "s1", "ffff0000ffff0000")]))
    assert any("near-duplicate" in p for p in verify_no_leakage([a, _record("c", "test", "drafter_3", "cghd/c", "s3", "0000000000000001")]))
    assert hamming("0f", "f0") == 8


def test_split_hash_is_frozen_by_content() -> None:
    """The split hash changes when an image, a label or the membership changes."""
    a = _record("a", "test", "drafter_1", "cghd/a", "s1", "0" * 16)
    base = split_hash([a], "test")
    assert split_hash([a], "test") == base
    assert split_hash([ImageRecord(**{**a.__dict__, "label_sha256": "other"})], "test") != base
    assert split_hash([a, _record("b", "test", "drafter_1", "cghd/b", "s2", "1" * 16)], "test") != base
    assert split_hash([a], "train") != base


def test_parse_pilot() -> None:
    """The pilot spec parses and rejects unknown splits."""
    assert parse_pilot("19:train,20:test") == {19: "train", 20: "test"}
    with pytest.raises(ValueError):
        parse_pilot("19:heldout_qual")


def test_class_flags_marks_low_real_test_counts() -> None:
    """A class with fewer than 30 real test instances is flagged synthetic-only."""
    counts = {"train": {"NMOS": 500}, "test": {"NMOS": 29, "PMOS": 30}}
    flags = class_flags(counts, ("NMOS", "PMOS"))
    assert FLAG_TOO_LOW in flags["NMOS"]
    assert FLAG_TOO_LOW not in flags["PMOS"]


def test_committed_manifest_is_leak_free_and_self_consistent() -> None:
    """The committed manifest passes the leakage verifier and its split hashes match their members."""
    if not config.MANIFEST_PATH.exists():
        pytest.skip("data_manifest.json not generated yet")
    manifest = json.loads(config.MANIFEST_PATH.read_text())
    assert verify(manifest, check_files=False) == []
    assert {r.split for r in manifest_records(manifest)} <= set(config.SPLITS)
    assert manifest["classes"] == list(load_schema().names)
    drafters = {r.group for r in manifest_records(manifest) if r.source == "cghd"}
    assert drafters == set(manifest["cghd"]["drafter_splits"])


def test_verify_detects_a_tampered_manifest() -> None:
    """Editing a split hash or moving one image across splits is reported."""
    if not config.MANIFEST_PATH.exists():
        pytest.skip("data_manifest.json not generated yet")
    manifest = json.loads(config.MANIFEST_PATH.read_text())
    tampered = json.loads(json.dumps(manifest))
    tampered["splits"]["test"]["hash"] = "0" * 64
    assert any("stored hash" in p for p in verify(tampered, check_files=False))
    moved = json.loads(json.dumps(manifest))
    victim = next(i for i in moved["images"] if i["split"] == "train" and i["source"] == "cghd")
    victim["split"] = "test"
    problems = verify(moved, check_files=False)
    assert any(f"group {victim['group']}" in p for p in problems)
