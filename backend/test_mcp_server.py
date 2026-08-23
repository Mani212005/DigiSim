import json
from mcp_server import (
    digisim_create_circuit,
    digisim_simulate_mna,
    digisim_detect_circuit_photo,
    digisim_export_spice,
    handle_rpc_request,
)


def test_digisim_create_circuit():
    netlist = {
        "circuit_name": "Test Gate Circuit",
        "components": [
            {"id": "1", "type": "SWITCH", "label": "Sw 1", "x": 50, "y": 100},
            {"id": "2", "type": "AND", "label": "AND 1", "x": 250, "y": 100},
            {"id": "3", "type": "LED", "label": "LED 1", "x": 450, "y": 100},
        ],
        "connections": [
            {"from": "1", "to": "2.a"},
            {"from": "2", "to": "3"},
        ],
    }

    res = digisim_create_circuit(netlist)
    assert res["status"] == "ok"
    assert len(res["nodes"]) == 3
    assert res["nodes"][0]["type"] == "input"
    assert res["nodes"][1]["type"] == "andGate"
    assert res["nodes"][2]["type"] == "output"
    assert len(res["edges"]) == 2


def test_digisim_simulate_mna():
    circuit = {
        "nodes": [
            {"id": "1", "type": "vsource", "data": {"param": 5.0}},
            {"id": "2", "type": "resistor", "data": {"param": 1000}},
            {"id": "3", "type": "ground", "data": {}},
        ],
        "edges": [
            {"id": "e1", "source": "1", "target": "2"},
            {"id": "e2", "source": "2", "target": "3"},
        ],
    }

    res = digisim_simulate_mna(circuit)
    assert res["status"] == "ok"
    assert "node_voltages" in res
    assert "branch_currents" in res
    assert "waveforms" in res
    assert res["node_voltages"]["1"] == 5.0
    assert res["node_voltages"]["3"] == 0.0


def test_digisim_detect_circuit_photo():
    # Blank 1x1 base64 PNG
    blank_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    res = digisim_detect_circuit_photo(blank_b64)
    assert res["status"] == "ok"
    assert "detections" in res
    assert "nodes" in res
    assert "edges" in res


def test_digisim_export_spice():
    circuit = {
        "title": "Test RC Filter",
        "nodes": [
            {"id": "1", "type": "vsource", "data": {"param": 5.0}},
            {"id": "2", "type": "resistor", "data": {"param": 1000}},
            {"id": "3", "type": "capacitor", "data": {"param": 10}},
        ],
        "edges": [
            {"id": "e1", "source": "1", "target": "2"},
            {"id": "e2", "source": "2", "target": "3"},
        ],
    }

    res = digisim_export_spice(circuit)
    assert res["status"] == "ok"
    assert "spice_text" in res
    assert "V1" in res["spice_text"]
    assert "R1" in res["spice_text"]
    assert "C1" in res["spice_text"]


def test_handle_rpc_request():
    init_req = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {},
    }
    resp = handle_rpc_request(init_req)
    assert resp["id"] == 1
    assert resp["result"]["serverInfo"]["name"] == "digisim-mcp-server"

    list_req = {
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {},
    }
    resp = handle_rpc_request(list_req)
    assert len(resp["result"]["tools"]) == 4

    call_req = {
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
            "name": "digisim_create_circuit",
            "arguments": {
                "netlist": {
                    "components": [{"id": "1", "type": "AND"}],
                    "connections": [],
                }
            },
        },
    }
    resp = handle_rpc_request(call_req)
    assert "content" in resp["result"]
    content_text = resp["result"]["content"][0]["text"]
    data = json.loads(content_text)
    assert data["status"] == "ok"
