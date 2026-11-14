"""
Module: class_map.py
Purpose: AUTO-GENERATED from ml/classes.yaml by ml/class_schema.py - do not edit by hand.
         Class vocabulary data for the detector: canonical names by YOLO id, legacy aliases
         that old weights still predict, and the class-to-frontend-node-type map.
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
