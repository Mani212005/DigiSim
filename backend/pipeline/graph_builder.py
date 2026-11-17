"""
Module: graph_builder.py
Purpose: Graph construction stage - turns a net trace into an undirected, net-based NetworkX
         graph: a bipartite multigraph with one node per component and one node per electrical
         net, and one edge per wired pin (component -- net, keyed by terminal name). Nets are
         undirected on purpose: a MOSFET's drain and source have no signal direction and a
         supply rail is shared by many devices, so no driver/consumer guess is made here (the
         old left/right-of-box gate heuristics are gone).
"""

from __future__ import annotations

import networkx as nx

from pipeline.trace_types import TraceResult

NET_PREFIX = "net:"


def net_node(net_id: str) -> str:
    """
    Graph node id of a net.

    Args:
        net_id: Net id from the trace (n0, n1, ...).
    Returns:
        Graph node id ("net:<id>"), distinct from every component id.
    """
    return f"{NET_PREFIX}{net_id}"


class GraphBuilder:
    """Builds the net-based circuit graph from a TraceResult."""

    def build(self, trace: TraceResult) -> nx.MultiGraph:
        """
        Construct the component/net bipartite multigraph.

        Args:
            trace: Output of NetTracer.trace.
        Returns:
            nx.MultiGraph. Component nodes carry kind="component", node_type, class_name, box, confidence,
            orientation, label and pins (terminal -> point); net nodes carry kind="net" and label; each edge
            (component, net, key=terminal) carries terminal.
        """
        graph = nx.MultiGraph(image_size=trace.image_size, diagnostics=trace.diagnostics)
        for comp in trace.components:
            graph.add_node(
                comp.id,
                kind="component",
                node_type=comp.node_type,
                class_name=comp.class_name,
                box=comp.box,
                confidence=comp.confidence,
                orientation=comp.orientation,
                label=comp.label,
                pin_source=comp.pin_source,
                pins={t: p.point for t, p in comp.pins.items()},
            )
        for net in trace.nets:
            graph.add_node(net_node(net.id), kind="net", net_id=net.id, label=net.label)
        for comp in trace.components:
            for terminal, pin in comp.pins.items():
                if pin.net is not None:
                    graph.add_edge(comp.id, net_node(pin.net), key=terminal, terminal=terminal)
        return graph
