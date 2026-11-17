"""
Module: class_map.py
Purpose: AUTO-GENERATED from ml/classes.yaml by ml/class_schema.py - do not edit by hand.
         Class vocabulary data for the detector: canonical names by YOLO id, legacy aliases
         that old weights still predict, the class-to-frontend-node-type map and the
         terminal names of each class (the net tracer's pin vocabulary).
         Regenerate with `cd ml && uv run python class_schema.py generate`.
"""

# Canonical class names; the index is the YOLO class id.
CLASS_NAMES: tuple[str, ...] = (
    "NMOS",
    "PMOS",
    "VDD",
    "GND",
    "INPUT_PORT",
    "OUTPUT_PORT",
    "JUNCTION",
    "AND",
    "OR",
    "NOT",
    "NAND",
    "NOR",
    "XOR",
    "XNOR",
    "RESISTOR",
    "CAPACITOR",
    "INDUCTOR",
    "BJT_NPN",
    "BJT_PNP",
    "CLOCK",
)

# Legacy (gate-era) class names -> canonical class, so old weights keep resolving.
CLASS_ALIASES: dict[str, str] = {
    "SWITCH": "INPUT_PORT",
    "INPUT": "INPUT_PORT",
    "OUTPUT": "OUTPUT_PORT",
    "LED": "OUTPUT_PORT",
}

# Class name (canonical and legacy) -> ReactFlow node type used by the frontend.
CLASS_TO_NODE_TYPE: dict[str, str] = {
    "NMOS": "nmos",
    "PMOS": "pmos",
    "VDD": "vsource",
    "GND": "ground",
    "INPUT_PORT": "input",
    "OUTPUT_PORT": "output",
    "JUNCTION": "junction",
    "AND": "andGate",
    "OR": "orGate",
    "NOT": "notGate",
    "NAND": "nandGate",
    "NOR": "norGate",
    "XOR": "xorGate",
    "XNOR": "xnorGate",
    "RESISTOR": "resistor",
    "CAPACITOR": "capacitor",
    "INDUCTOR": "inductor",
    "BJT_NPN": "bjtNpn",
    "BJT_PNP": "bjtPnp",
    "CLOCK": "clockSource",
    "SWITCH": "input",
    "INPUT": "input",
    "OUTPUT": "output",
    "LED": "output",
}

# Canonical class name -> terminal names, in the frontend handle naming (t:<name> / s:<name>).
CLASS_TERMINALS: dict[str, tuple[str, ...]] = {
    "NMOS": ("d", "g", "s", "b"),
    "PMOS": ("s", "g", "d", "b"),
    "VDD": ("pos", "neg"),
    "GND": ("gnd",),
    "INPUT_PORT": ("out",),
    "OUTPUT_PORT": ("a",),
    "JUNCTION": ("net",),
    "AND": ("a", "b", "out"),
    "OR": ("a", "b", "out"),
    "NOT": ("a", "out"),
    "NAND": ("a", "b", "out"),
    "NOR": ("a", "b", "out"),
    "XOR": ("a", "b", "out"),
    "XNOR": ("a", "b", "out"),
    "RESISTOR": ("a", "b"),
    "CAPACITOR": ("a", "b"),
    "INDUCTOR": ("a", "b"),
    "BJT_NPN": ("c", "b", "e"),
    "BJT_PNP": ("c", "b", "e"),
    "CLOCK": ("out",),
}
