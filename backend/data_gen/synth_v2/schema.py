"""
Module: schema.py
Purpose: Loads the detector class vocabulary from ml/classes.yaml (the single source of
         truth) for the v2 generator, so class names and YOLO ids are never redefined here.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
_ML_DIR = REPO_ROOT / "ml"
if str(_ML_DIR) not in sys.path:
    sys.path.insert(0, str(_ML_DIR))

from class_schema import SCHEMA_VERSION, load_schema, render_data_yaml  # noqa: E402,F401  (re-exported)

SCHEMA = load_schema()
TIER_A: tuple[str, ...] = tuple(c.name for c in SCHEMA.classes_up_to("A"))
CLASS_ID: dict[str, int] = {c.name: c.id for c in SCHEMA.classes}
NODE_TYPE: dict[str, str] = {c.name: c.node_type for c in SCHEMA.classes}
TERMINALS: dict[str, tuple[str, ...]] = {c.name: c.terminals for c in SCHEMA.classes}
