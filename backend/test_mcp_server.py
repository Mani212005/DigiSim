"""
Module: test_mcp_server.py
Purpose: Pytest unit test suite for backend/mcp_server.py tools and RPC handlers.
"""

import json
from mcp_server import (
    digisim_create_circuit,
    digisim_detect_circuit_photo,
    digisim_export_spice,
    digisim_simulate_mna,
    handle_call_tool,
)


def test_digisim_create_circuit():
    res = digisim_create_circuit(circuit_name="Test Circuit")
    assert res["status"] == "ok"
    assert res["circuit_name"] == "Test Circuit"
    assert len(res["nodes"]) == 4
    assert len(res["edges"]) == 3


def test_digisim_simulate_mna():
    res = digisim_simulate_mna(time_steps=5)
    assert res["status"] == "ok"
    assert "net_v1" in res["node_voltages"]
    assert len(res["waveforms"]) == 5


def test_digisim_detect_circuit_photo():
    # Small test 1x1 GIF base64
    b64_img = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
    res = digisim_detect_circuit_photo(b64_img, confidence_threshold=0.3)
    assert res["status"] == "ok"
    assert len(res["detections"]) > 0
    assert "nodes" in res["circuit_proposal"]


def test_digisim_export_spice():
    res = digisim_export_spice("Test SPICE")
    assert "* DigiSim SPICE Netlist Export: Test SPICE" in res
    assert ".dc V1 0 5 0.1" in res
    assert ".end" in res


def test_handle_call_tool():
    res = handle_call_tool("digisim_create_circuit", {"circuit_name": "RPC Test"})
    assert len(res) == 1
    data = json.loads(res[0]["text"])
    assert data["circuit_name"] == "RPC Test"
