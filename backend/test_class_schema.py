"""
Module: test_class_schema.py
Purpose: Contract tests tying the backend detector class map to ml/classes.yaml, the single
         source of truth for the detector vocabulary. Also verifies the generated files are
         not stale and that legacy gate-era class names still resolve for old weights.
"""

import importlib.util
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = REPO_ROOT / "ml" / "classes.yaml"

from pipeline import detector  # noqa: E402
from pipeline.class_map import CLASS_ALIASES, CLASS_NAMES, CLASS_TERMINALS, CLASS_TO_NODE_TYPE  # noqa: E402


def _load_class_schema_module():
    """
    Import ml/class_schema.py (not on the backend path) as a module.

    Returns:
        The imported class_schema module.
    """
    spec = importlib.util.spec_from_file_location("class_schema", REPO_ROOT / "ml" / "class_schema.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["class_schema"] = module
    spec.loader.exec_module(module)
    return module


def _yaml_doc() -> dict:
    """
    Parse ml/classes.yaml directly, independent of the generator.

    Returns:
        The parsed YAML document.
    """
    return yaml.safe_load(SCHEMA_PATH.read_text())


def test_backend_map_equals_yaml():
    """CLASS_TO_NODE_TYPE holds exactly the YAML classes plus legacy aliases."""
    doc = _yaml_doc()
    expected = {c["name"]: c["node_type"] for c in doc["classes"]}
    for alias, canonical in doc["aliases"].items():
        expected[alias] = expected[canonical]
    assert CLASS_TO_NODE_TYPE == expected
    assert detector.CLASS_TO_NODE_TYPE is CLASS_TO_NODE_TYPE


def test_class_names_follow_yolo_ids():
    """CLASS_NAMES is ordered so that index equals the YOLO class id from the YAML."""
    doc = _yaml_doc()
    assert list(CLASS_NAMES) == [c["name"] for c in sorted(doc["classes"], key=lambda c: c["id"])]
    assert [c["id"] for c in doc["classes"]] == list(range(len(doc["classes"])))
    assert CLASS_ALIASES == doc["aliases"]


def test_class_terminals_equal_yaml():
    """CLASS_TERMINALS (the net tracer's pin vocabulary) lists every canonical class's YAML terminals in order."""
    doc = _yaml_doc()
    assert CLASS_TERMINALS == {c["name"]: tuple(c["terminals"]) for c in doc["classes"]}


def test_generated_files_are_fresh():
    """Generated backend and frontend files match what the generator renders from the YAML."""
    schema_mod = _load_class_schema_module()
    assert schema_mod.stale_files(schema_mod.load_schema()) == []


def test_legacy_names_resolve_for_old_weights():
    """The 12 upper-case gate-era names an old model predicts keep their node types."""
    legacy = ["AND", "OR", "NOT", "NAND", "NOR", "XOR", "XNOR", "SWITCH", "INPUT", "OUTPUT", "LED", "JUNCTION"]
    assert all(n in CLASS_TO_NODE_TYPE for n in legacy)
    assert CLASS_TO_NODE_TYPE["AND"] == "andGate"
    assert CLASS_TO_NODE_TYPE["SWITCH"] == "input"
    assert CLASS_TO_NODE_TYPE["INPUT"] == "input"
    assert CLASS_TO_NODE_TYPE["OUTPUT"] == "output"
    assert CLASS_TO_NODE_TYPE["LED"] == "output"
    assert CLASS_TO_NODE_TYPE["JUNCTION"] == "junction"


def test_data_yaml_uses_tier_a_by_default(tmp_path):
    """The generated data.yaml lists tier A classes in id order and widens with tier B."""
    schema_mod = _load_class_schema_module()
    schema = schema_mod.load_schema()
    doc = yaml.safe_load(schema_mod.render_data_yaml(schema, tmp_path))
    tier_a = [c["name"] for c in _yaml_doc()["classes"] if c["tier"] == "A"]
    assert doc["names"] == tier_a
    assert doc["nc"] == len(tier_a)
    wide = yaml.safe_load(schema_mod.render_data_yaml(schema, tmp_path, "B"))
    assert wide["names"] == list(CLASS_NAMES)
