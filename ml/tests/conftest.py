"""
Module: conftest.py
Purpose: Shared pytest fixtures for the ml/ evaluation-harness tests: small hand-built CMOS netlists
         (inverter, NAND) in the netlist JSON schema of ml/eval_netlist.py and helpers to write them to disk.
"""

import json
from pathlib import Path

import pytest


def nand_netlist(with_boxes: bool = False, prefix: str = "", shift: float = 0.0) -> dict:
    """
    A 2-input CMOS NAND as a netlist dict.

    Args:
        with_boxes: Attach a bbox to every component.
        prefix: Prepended to every component id (to test id-independent matching).
        shift: Added to every bbox coordinate (to test IoU tolerance).
    Returns:
        Netlist dict with components and nets.
    """
    names = {"A": "input", "B": "input", "VDD": "vsource", "GND": "ground", "MP1": "pmos", "MP2": "pmos", "MN1": "nmos", "MN2": "nmos", "Y": "output"}
    comps = []
    for i, (cid, ctype) in enumerate(names.items()):
        comp = {"id": f"{prefix}{cid}", "type": ctype}
        if with_boxes:
            x = 100.0 * i + shift
            comp["bbox"] = [x, 10 + shift, x + 60, 90 + shift]
        comps.append(comp)
    p = prefix
    nets = [
        [f"{p}A:out", f"{p}MP1:g", f"{p}MN1:g"],
        [f"{p}B:out", f"{p}MP2:g", f"{p}MN2:g"],
        [f"{p}VDD:pos", f"{p}MP1:s", f"{p}MP2:s"],
        [f"{p}MP1:d", f"{p}MP2:d", f"{p}MN1:d", f"{p}Y:a"],
        [f"{p}MN1:s", f"{p}MN2:d"],
        [f"{p}MN2:s", f"{p}GND:gnd"],
    ]
    return {"components": comps, "nets": nets}


@pytest.fixture
def write_netlist(tmp_path: Path):
    """
    Factory that writes a netlist dict to <tmp>/<dir>/<stem>.json.

    Args:
        tmp_path: pytest temporary directory.
    Returns:
        Callable (directory name, stem, netlist dict) -> directory path.
    """

    def _write(directory: str, stem: str, netlist: dict) -> Path:
        folder = tmp_path / directory
        folder.mkdir(exist_ok=True)
        (folder / f"{stem}.json").write_text(json.dumps(netlist))
        return folder

    return _write
