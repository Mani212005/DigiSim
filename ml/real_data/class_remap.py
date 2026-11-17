"""
Module: class_remap.py
Purpose: Maps the source label vocabularies (CGHD classes, the Roboflow gate export) onto the DigiSim
         detector classes in ml/classes.yaml, and holds the text triage that decides whether a CGHD
         `terminal` is an input port, an output port or a supply. Classes that have no DigiSim
         equivalent are ignored (not labelled), never silently renamed.
"""

import re

from class_schema import ClassSchema

# CGHD class -> DigiSim class for classes whose meaning carries over one to one.
CGHD_DIRECT: dict[str, str] = {
    "and": "AND",
    "or": "OR",
    "not": "NOT",
    "nand": "NAND",
    "nor": "NOR",
    "xor": "XOR",
    "gnd": "GND",
    "junction": "JUNCTION",
    "voltage.dc": "VDD",
    "vss": "VDD",
    "resistor": "RESISTOR",
    "capacitor.unpolarized": "CAPACITOR",
    "capacitor.polarized": "CAPACITOR",
    "inductor": "INDUCTOR",
}

# CGHD classes that need a per-instance decision instead of a fixed mapping.
CGHD_FET = "transistor.fet"
CGHD_TERMINAL = "terminal"
CGHD_TEXT = "text"

# Roboflow export class names (data.yaml `names`) -> DigiSim class.
ROBOFLOW_NAMES: dict[str, str] = {
    "and gate": "AND",
    "nand gate": "NAND",
    "nor gate": "NOR",
    "not gate": "NOT",
    "or gate": "OR",
    "xor gate": "XOR",
}

# Component designators (R1, C2, D1, Q1, U1, S1, F1, Y1) must never be read as ports, so the patterns only
# accept names that textbooks use for signals: bare single letters and explicit in/out words.
_INPUT_TEXT = re.compile(r"^(v_?in\d*|in\d*|input\d*|[abcdx]|[ab]\d|clk|clock|en)$")
_OUTPUT_TEXT = re.compile(r"^(v_?out\d*|v_?o|out\d*|output\d*|[yzqf]|q'|qn|q_?bar)$")
_VDD_TEXT = re.compile(r"^(v_?dd|v_?cc|\+v|v\+)$")
_VOLTAGE_TEXT = re.compile(r"^(\+\d+(\.\d+)?v?|\d+(\.\d+)?v)$")
# Rail labels above this are mains or high-voltage terminals, not a supply symbol of a signal-level circuit.
MAX_RAIL_VOLTS = 60.0
_GND_TEXT = re.compile(r"^(gnd|ground|0|0v|v_?ss|v-)$")


def _normalise_text(text: str) -> str:
    """
    Lower-case a CGHD text label and drop whitespace and LaTeX-style decoration.

    Args:
        text: Raw label from a CGHD `text` object.
    Returns:
        The label in a canonical form for regex matching.
    """
    return re.sub(r"[\s{}$\\]", "", text.strip().lower())


def classify_terminal(text: str | None) -> str | None:
    """
    Decide what a CGHD `terminal` is from the label next to it.

    Args:
        text: Label of the nearest text object, or None when there is none.
    Returns:
        A DigiSim class name (INPUT_PORT, OUTPUT_PORT, VDD or GND), or None when the label does not
        settle it. None means "uncertain": the instance is flagged and left out of the labels.
    """
    if not text:
        return None
    norm = _normalise_text(text)
    if _VDD_TEXT.match(norm):
        return "VDD"
    if _VOLTAGE_TEXT.match(norm):
        return "VDD" if float(norm.strip("+v")) <= MAX_RAIL_VOLTS else None
    if _GND_TEXT.match(norm):
        return "GND"
    if _INPUT_TEXT.match(norm):
        return "INPUT_PORT"
    if _OUTPUT_TEXT.match(norm):
        return "OUTPUT_PORT"
    return None


def validate_remaps(schema: ClassSchema) -> None:
    """
    Check that every target class of every remap exists in classes.yaml.

    Args:
        schema: The validated class schema.
    Raises:
        ValueError: If a remap points at a class the schema does not define.
    """
    known = set(schema.names)
    targets = set(CGHD_DIRECT.values()) | set(ROBOFLOW_NAMES.values()) | {"NMOS", "PMOS", "INPUT_PORT", "OUTPUT_PORT", "VDD", "GND"}
    missing = sorted(targets - known)
    if missing:
        raise ValueError(f"Remap targets not in classes.yaml: {missing}")
