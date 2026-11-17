"""
Module: circuit_exporter.py
Purpose: JSON export stage - serialises the net-based circuit graph into DigiSim-importable
         JSON. This is Stage 4 (final stage) of the detection pipeline.

Output (schema_version 2):
    {
      "schema_version": 2,
      "image": {"width": 1024, "height": 768},
      "components": [
        {"id": "MP1", "type": "pmos", "class": "PMOS", "label": "MP1",
         "x": 262.3, "y": 194.3, "width": 42.0, "height": 74.4, "bbox": [x1, y1, x2, y2],
         "confidence": 0.93, "orientation": {"rotation": 0, "mirror": true}, "pin_source": "keypoints",
         "pins": {"s": {"x": 265.7, "y": 196.3, "net": "n2"}, "g": {...}, "d": {...}},
         "library_cell": null},
        {"id": "U1", "type": "nandGate", ..., "library_cell": {"id": "std-nand", "pins": {"a": "a", "b": "b", "out": "out"}}}
      ],
      "nets": [{"id": "n2", "label": "VDD", "pins": ["MP1:s", "VDD1:pos"]}, ...],
      "edges": [{"id": "e0", "source": "VDD1", "sourceHandle": "s:pos", "target": "MP1", "targetHandle": "t:s"}, ...],
      "connections": [{"from": "IN1", "to": "U1", "fromPort": "output", "toPort": "a"}, ...],
      "warnings": []
    }
    - components[].type is a frontend node type from ml/classes.yaml: nmos, pmos, vsource, ground, input,
      output (the transistor-first palette), the legacy gate node types, or tier-B analog types. Gate symbols
      also name the seeded standard cell (frontend/src/logic/library/standardCells.ts) they map to, with the
      detector terminal -> cell pin id map; XNOR has no seeded cell and stays a legacy gate (library_cell null).
    - nets are undirected sets of "<component id>:<terminal>" pins - the same shape ml/eval_netlist.py scores.
    - edges realise every net as ReactFlow edges with the app's handle ids (t:/s: prefixed for transistor-level
      nodes, a/b for gate inputs, null for single-handle nodes), rooted at the net's driver when it has one;
      this is what the transistor-first importer (T9) consumes.
    - connections is the legacy (schema 1) directed gate-level list, kept so the current importer
      (App.tsx importCircuit, CircuitExportJSON) still wires gate-level circuits; it only lists links between
      input/output/gate components.
"""

from __future__ import annotations

import networkx as nx

SCHEMA_VERSION = 2

GATE_TYPES = frozenset({"andGate", "orGate", "notGate", "nandGate", "norGate", "xorGate", "xnorGate"})
# Node types whose handles carry a t:/s: prefix (target/source variants of each terminal).
HANDLE_PREFIX_TYPES = frozenset({"nmos", "pmos", "vsource", "ground", "clockSource", "resistor", "capacitor", "inductor", "bjtNpn", "bjtPnp"})
LEGACY_TYPES = GATE_TYPES | {"input", "output"}

# Gate node type -> seeded standard cell and the detector-terminal -> cell-pin-id map.
LIBRARY_CELLS: dict[str, dict[str, object]] = {
    "notGate": {"id": "std-not", "pins": {"a": "in", "out": "out"}},
    "nandGate": {"id": "std-nand", "pins": {"a": "a", "b": "b", "out": "out"}},
    "norGate": {"id": "std-nor", "pins": {"a": "a", "b": "b", "out": "out"}},
    "andGate": {"id": "std-and", "pins": {"a": "a", "b": "b", "out": "out"}},
    "orGate": {"id": "std-or", "pins": {"a": "a", "b": "b", "out": "out"}},
    "xorGate": {"id": "std-xor", "pins": {"a": "a", "b": "b", "out": "out"}},
}

# Human-readable fallback labels for ReactFlow node types.
NODE_TYPE_LABELS: dict[str, str] = {
    "andGate": "AND Gate",
    "orGate": "OR Gate",
    "notGate": "NOT Gate",
    "nandGate": "NAND Gate",
    "norGate": "NOR Gate",
    "xorGate": "XOR Gate",
    "xnorGate": "XNOR Gate",
    "input": "Input",
    "output": "Output",
    "nmos": "NMOS",
    "pmos": "PMOS",
    "vsource": "VDD",
    "ground": "GND",
}


def _is_driver(node_type: str, terminal: str) -> bool:
    """
    Whether a pin drives its net in gate-level evaluation.

    Args:
        node_type: Frontend node type.
        terminal: Terminal name.
    Returns:
        True for an input port output and a gate output.
    """
    return terminal == "out" and (node_type == "input" or node_type in GATE_TYPES)


def source_handle(node_type: str, terminal: str) -> str | None:
    """
    ReactFlow source handle id of a pin.

    Args:
        node_type: Frontend node type.
        terminal: Terminal name.
    Returns:
        "s:<terminal>" for prefixed node types, None for single/default-output nodes.
    """
    return f"s:{terminal}" if node_type in HANDLE_PREFIX_TYPES else None


def target_handle(node_type: str, terminal: str) -> str | None:
    """
    ReactFlow target handle id of a pin.

    Args:
        node_type: Frontend node type.
        terminal: Terminal name.
    Returns:
        "t:<terminal>" for prefixed node types, the input id for gates, None for single-handle nodes.
    """
    if node_type in HANDLE_PREFIX_TYPES:
        return f"t:{terminal}"
    return terminal if node_type in GATE_TYPES else None


class CircuitExporter:
    """Serialises the net-based circuit graph to DigiSim JSON (schema_version 2, plus legacy connections)."""

    def export(self, graph: nx.MultiGraph) -> dict[str, object]:
        """
        Convert a circuit graph into a DigiSim-importable JSON dict.

        Args:
            graph: A networkx.MultiGraph produced by GraphBuilder.build.
        Returns:
            Dict with schema_version, image, components, nets, edges, connections and warnings (see module docstring).
        """
        comps = {n: a for n, a in graph.nodes(data=True) if a.get("kind") == "component"}
        nets = {n: a for n, a in graph.nodes(data=True) if a.get("kind") == "net"}
        net_pins: dict[str, list[tuple[str, str]]] = {n: [] for n in nets}
        pin_net: dict[tuple[str, str], str] = {}
        for u, v, terminal in graph.edges(keys=True):
            comp, net = (u, v) if u in comps else (v, u)
            net_pins[net].append((comp, terminal))
            pin_net[(comp, terminal)] = nets[net]["net_id"]

        components = []
        for cid, a in comps.items():
            x1, y1, x2, y2 = a["box"]
            o = a.get("orientation")
            pins = {
                t: {"x": None if p is None else round(float(p[0]), 1), "y": None if p is None else round(float(p[1]), 1), "net": pin_net.get((cid, t))} for t, p in sorted(a.get("pins", {}).items())
            }
            components.append(
                {
                    "id": cid,
                    "type": a["node_type"],
                    "class": a["class_name"],
                    "label": a.get("label") or NODE_TYPE_LABELS.get(a["node_type"], a["class_name"]),
                    "x": round(float(x1), 1),
                    "y": round(float(y1), 1),
                    "width": round(float(x2 - x1), 1),
                    "height": round(float(y2 - y1), 1),
                    "bbox": [round(float(v), 1) for v in (x1, y1, x2, y2)],
                    "confidence": round(float(a.get("confidence", 0.0)), 3),
                    "orientation": None if o is None else {"rotation": o.rotation, "mirror": o.mirror},
                    "pin_source": a.get("pin_source"),
                    "pins": pins,
                    "library_cell": LIBRARY_CELLS.get(a["node_type"]),
                }
            )

        net_list = []
        edges = []
        connections = []
        for net, members in sorted(net_pins.items(), key=lambda kv: nets[kv[0]]["net_id"]):
            pins = sorted(f"{c}:{t}" for c, t in members)
            net_list.append({"id": nets[net]["net_id"], "label": nets[net].get("label"), "pins": pins})
            if len(members) < 2:
                continue
            ordered = sorted(members)
            root = next((m for m in ordered if _is_driver(comps[m[0]]["node_type"], m[1])), None)
            root = root or next((m for m in ordered if comps[m[0]]["node_type"] != "output"), ordered[0])
            rtype = comps[root[0]]["node_type"]
            for comp, terminal in ordered:
                if (comp, terminal) == root:
                    continue
                ctype = comps[comp]["node_type"]
                edges.append(
                    {
                        "id": f"e{len(edges)}",
                        "source": root[0],
                        "sourceHandle": source_handle(rtype, root[1]),
                        "target": comp,
                        "targetHandle": target_handle(ctype, terminal),
                    }
                )
                if _is_driver(rtype, root[1]) and ctype in LEGACY_TYPES and ctype != "input" and comp != root[0]:
                    connections.append({"from": root[0], "to": comp, "fromPort": "output", "toPort": target_handle(ctype, terminal)})

        diagnostics = graph.graph.get("diagnostics")
        width, height = graph.graph.get("image_size", (0, 0))
        return {
            "schema_version": SCHEMA_VERSION,
            "image": {"width": width, "height": height},
            "components": components,
            "nets": net_list,
            "edges": edges,
            "connections": connections,
            "warnings": list(getattr(diagnostics, "warnings", [])),
        }
