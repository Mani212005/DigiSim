"""
Module: test_eval_netlist.py
Purpose: Tests for ml/eval_netlist.py - netlist validation (nets-of-pins, net objects and the T2
         generator's pin-map shape), component matching (by bbox and by id),
         pin-pair net precision/recall, exact match, bulk-pin handling, conversion to a DigiSim
         canvas, and truth-table equivalence through DigiSim's real simulator (skipped when node or
         the frontend dependencies are unavailable).
"""

import copy
import json
from pathlib import Path

import pytest
from conftest import nand_netlist

from eval_netlist import (
    BridgeError,
    NetlistError,
    evaluate_netlists,
    from_pin_map,
    match_components,
    parse_netlist,
    pin_pairs,
    remap_pins,
    run_truth_tables,
    scored_nets,
    to_digisim,
)


def simulator_available() -> bool:
    """
    Whether the Node simulator bridge can run here.

    Returns:
        True when a trivial circuit simulates.
    """
    try:
        run_truth_tables({"probe": to_digisim(parse_netlist(nand_netlist()))})
    except BridgeError:
        return False
    return True


needs_simulator = pytest.mark.skipif(not simulator_available(), reason="node and `cd frontend && npm install` are required for truth-table tests")


def test_parse_rejects_bad_netlists() -> None:
    """Unknown types, duplicate ids, bad pins and unknown terminals are errors."""
    ok = nand_netlist()
    bad_type = copy.deepcopy(ok)
    bad_type["components"][0]["type"] = "flux_capacitor"
    bad_pin = copy.deepcopy(ok)
    bad_pin["nets"][0].append("MP1:zzz")
    dup = copy.deepcopy(ok)
    dup["components"].append(dict(dup["components"][0]))
    for broken in (bad_type, bad_pin, dup, {"components": []}):
        with pytest.raises(NetlistError):
            parse_netlist(broken)


def test_nets_sharing_a_pin_are_merged() -> None:
    """Two listed nets that share a pin are one net."""
    raw = nand_netlist()
    raw["nets"] = [["A:out", "MP1:g"], ["MP1:g", "MN1:g"]]
    net = parse_netlist(raw).nets
    assert net == [frozenset({"A:out", "MP1:g", "MN1:g"})]


def test_bulk_pins_are_not_scored() -> None:
    """A MOSFET bulk connection is ignored when nets are reduced to scored pins."""
    raw = nand_netlist()
    raw["nets"][2].append("MP1:b")
    netlist = parse_netlist(raw)
    assert any("MP1:b" in net for net in netlist.nets)
    assert all("MP1:b" not in net for net in scored_nets(netlist))


def test_match_by_bbox_survives_renamed_ids_and_small_shifts() -> None:
    """Predicted components are paired with ground truth by IoU and type, not id."""
    gt = parse_netlist(nand_netlist(with_boxes=True))
    pred = parse_netlist(nand_netlist(with_boxes=True, prefix="p_", shift=2.0))
    mapping = match_components(gt, pred)
    assert mapping == {f"p_{c}": c for c in gt.components}
    assert pin_pairs(remap_pins(scored_nets(pred), mapping)) == pin_pairs(scored_nets(gt))
    unboxed = parse_netlist(nand_netlist())
    assert match_components(unboxed, parse_netlist(nand_netlist())) == {c: c for c in unboxed.components}
    assert match_components(unboxed, pred) == {}


def run_one(tmp_path: Path, pred: dict | None, gt: dict | None = None, **kwargs) -> dict:
    """
    Evaluate a single prediction against a ground truth (default: a boxed NAND).

    Args:
        tmp_path: Temporary directory.
        pred: Predicted netlist dict.
        gt: Ground-truth netlist dict.
        **kwargs: Extra evaluate_netlists arguments.
    Returns:
        The overall end-to-end record.
    """
    (tmp_path / "gt").mkdir(exist_ok=True)
    (tmp_path / "pred").mkdir(exist_ok=True)
    (tmp_path / "gt" / "syn_0.json").write_text(json.dumps(gt or nand_netlist(with_boxes=True)))
    if pred is not None:
        (tmp_path / "pred" / "syn_0.json").write_text(json.dumps(pred))
    return evaluate_netlists(tmp_path / "gt", tmp_path / "pred", **kwargs)


def test_perfect_prediction_scores_one(tmp_path: Path) -> None:
    """Same circuit under renamed ids: P = R = F1 = 1 and exact match."""
    result = run_one(tmp_path, nand_netlist(with_boxes=True, prefix="p_", shift=1.0), truth_table=False)
    overall = result["overall"]
    assert overall["net_micro"]["f1"] == 1.0 and overall["exact_match"]["value"] == 1.0
    assert result["circuits"]["syn_0"]["domain"] == "synthetic"


def test_missing_wire_lowers_recall_only(tmp_path: Path) -> None:
    """Dropping a pin from a net removes true pairs (recall down, precision still 1) and breaks exact match."""
    pred = nand_netlist(with_boxes=True)
    pred["nets"][3].remove("MN1:d")
    overall = run_one(tmp_path, pred, truth_table=False)["overall"]
    assert overall["net_micro"]["precision"] == 1.0
    assert overall["net_micro"]["recall"] < 1.0
    assert overall["exact_match"]["value"] == 0.0


def test_spurious_component_breaks_exact_match_but_not_recall(tmp_path: Path) -> None:
    """An extra predicted component with a spurious wire adds false pairs and fails exact match."""
    pred = nand_netlist(with_boxes=True)
    pred["components"].append({"id": "X", "type": "nmos", "bbox": [5000, 5000, 5060, 5090]})
    pred["nets"].append(["X:d", "GND:gnd"])
    overall = run_one(tmp_path, pred, truth_table=False)["overall"]
    assert overall["net_micro"]["recall"] == 1.0 and overall["net_micro"]["precision"] < 1.0
    assert overall["exact_match"]["value"] == 0.0


def test_missing_and_malformed_predictions_score_zero(tmp_path: Path) -> None:
    """No prediction file, or an invalid one, is an empty circuit with the error recorded."""
    missing = run_one(tmp_path, None, truth_table=False)["circuits"]["syn_0"]
    assert missing["pred_error"] == "missing prediction" and missing["pairs"]["tp"] == 0 and missing["exact_match"] is False
    broken = nand_netlist(with_boxes=True)
    broken["nets"][0].append("NOPE:g")
    bad = run_one(tmp_path, broken, truth_table=False)["circuits"]["syn_0"]
    assert bad["pred_error"] and bad["pairs"]["tp"] == 0


def test_to_digisim_uses_app_handle_ids() -> None:
    """Transistor pins become t:/s: handles, gate inputs plain handles, and drivers root their nets."""
    graph = to_digisim(parse_netlist(nand_netlist()))
    edges = {(e["source"], e["sourceHandle"], e["target"], e["targetHandle"]) for e in graph["edges"]}
    assert ("A", None, "MP1", "t:g") in edges  # input drives a transistor gate
    assert ("MN1", "s:d", "Y", None) in edges  # transistor drain into the output node (root = first non-output pin)
    gate = parse_netlist({"components": [{"id": "G", "type": "andGate"}, {"id": "I", "type": "input"}], "nets": [["I:out", "G:a"]]})
    assert [(e["source"], e["target"], e["targetHandle"]) for e in to_digisim(gate)["edges"]] == [("I", "G", "a")]


@needs_simulator
def test_truth_table_equivalence_with_digisim_simulator(tmp_path: Path) -> None:
    """A correct NAND is equivalent under renamed ids; a NAND with its NMOS stack in parallel (a different function) is not."""
    good = run_one(tmp_path, nand_netlist(with_boxes=True, prefix="p_", shift=1.0))["overall"]
    assert good["truth_table"]["value"] == 1.0 and good["truth_table"]["n"] == 1
    wrong = nand_netlist(with_boxes=True)
    wrong["nets"][4] = ["MN1:s", "GND:gnd"]  # both NMOS now sink straight to ground: parallel, i.e. NOR-like pull-down
    wrong["nets"][5] = ["MN2:s", "GND:gnd", "MN1:s"]
    wrong["nets"][3] = ["MP1:d", "MP2:d", "MN1:d", "MN2:d", "Y:a"]
    result = run_one(tmp_path, wrong)["overall"]
    assert result["truth_table"]["value"] == 0.0
    assert result["net_micro"]["f1"] > 0.6  # structurally close, functionally wrong: why both metrics exist


@needs_simulator
def test_truth_table_of_ground_truth_nand_is_correct() -> None:
    """The simulator returns the NAND truth table for the fixture (A, B -> Y)."""
    table = run_truth_tables({"nand": to_digisim(parse_netlist(nand_netlist()))})["nand"]
    assert table["inputs"] == ["A", "B"] and table["outputs"] == ["Y"]
    assert table["rows"] == [[0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 0]]


def test_net_objects_are_accepted() -> None:
    """Nets given as objects with a "pins" list (the exporter's schema 2 form) parse like plain pin lists."""
    raw = nand_netlist()
    as_objects = {**raw, "nets": [{"id": f"n{i}", "label": None, "pins": pins} for i, pins in enumerate(raw["nets"])]}
    assert parse_netlist(as_objects).nets == parse_netlist(raw).nets


def test_pin_map_netlist_from_the_generator() -> None:
    """The T2 generator's netlist.json (components with a terminal -> net-name map) converts to nets of pins."""
    t2 = {
        "components": [
            {"id": "IN_A", "class": "INPUT_PORT", "node_type": "input", "pins": {"out": "A"}},
            {"id": "M1", "class": "NMOS", "node_type": "nmos", "pins": {"d": "Y", "g": "A", "s": "GND"}},
            {"id": "GND1", "class": "GND", "node_type": "ground", "pins": {"gnd": "GND"}},
            {"id": "OUT_Y", "class": "OUTPUT_PORT", "node_type": "output", "pins": {"a": "Y"}},
        ],
        "nets": ["A", "GND", "Y"],
    }
    assert from_pin_map(t2)["nets"] == [["IN_A:out", "M1:g"], ["GND1:gnd", "M1:s"], ["M1:d", "OUT_Y:a"]]
    parsed = parse_netlist(t2)
    assert {c.type for c in parsed.components.values()} == {"input", "nmos", "ground", "output"}
    assert set(parsed.nets) == {frozenset({"IN_A:out", "M1:g"}), frozenset({"GND1:gnd", "M1:s"}), frozenset({"M1:d", "OUT_Y:a"})}
