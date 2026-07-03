"""
Module: circuit_exporter.py
Purpose: JSON export stage — serialises a circuit graph into DigiSim-importable JSON.
         This is Stage 4 (final stage) of the detection pipeline.

Output format (matches CircuitExportJSON in frontend/src/types/api.ts):
    {
        "components": [
            {"id": "comp_0", "type": "andGate", "label": "AND Gate",
             "x": 120, "y": 80}
        ],
        "connections": [
            {"from": "comp_0", "to": "comp_1",
             "fromPort": "output", "toPort": "a"}
        ]
    }
"""

import networkx as nx

# Human-readable labels for ReactFlow node types.
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
}


class CircuitExporter:
    """Serialises a NetworkX circuit graph to DigiSim JSON format."""

    def export(self, graph: nx.DiGraph) -> dict:
        """
        Convert a circuit graph into a DigiSim-importable JSON dict.

        Args:
            graph: A networkx.DiGraph produced by GraphBuilder.
        Returns:
            Dict with 'components' and 'connections' keys matching
            CircuitExportJSON.
        """
        components = []
        for node_id, attrs in graph.nodes(data=True):
            node_type = attrs.get("node_type", "input")
            components.append(
                {
                    "id": node_id,
                    "type": node_type,
                    "label": NODE_TYPE_LABELS.get(
                        node_type, attrs.get("class_name", "Component")
                    ),
                    "x": round(float(attrs.get("x", 0.0)), 1),
                    "y": round(float(attrs.get("y", 0.0)), 1),
                    "confidence": round(float(attrs.get("confidence", 0.0)), 3),
                }
            )

        connections = []
        for src, dst, attrs in graph.edges(data=True):
            connections.append(
                {
                    "from": src,
                    "to": dst,
                    "fromPort": attrs.get("fromPort", "output"),
                    "toPort": attrs.get("toPort"),
                }
            )

        return {"components": components, "connections": connections}
