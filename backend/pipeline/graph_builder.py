"""
Module: graph_builder.py
Purpose: Graph construction stage — converts gate detections and wire segments into a
         directed NetworkX graph representing the circuit topology.

Approach:
    1. Wire segments are clustered into electrical nets with union-find: two
       segments join the same net when any of their endpoints are close.
    2. A net touches a gate when one of its endpoints falls inside the gate's
       inflated bounding box; touching the right half of the box means the
       gate drives the net (output), the left half means the net feeds it.
    3. Each net becomes directed edges source-gate → target-gate(s). Junction
       detections are ignored as nodes — the dot ink already keeps nets whole.
"""

from dataclasses import dataclass

import networkx as nx

from pipeline.detector import CLASS_TO_NODE_TYPE, Detection
from pipeline.wire_extractor import WireSegment

NET_JOIN_DISTANCE = 16.0  # px — endpoints closer than this share a net
BOX_INFLATE = 16.0  # px — contact tolerance around gate boxes


@dataclass
class CircuitNode:
    """A single circuit component node in the graph."""

    id: str
    node_type: str
    x: float
    y: float


class _UnionFind:
    """Minimal union-find over integer indices for net clustering."""

    def __init__(self, n: int) -> None:
        """
        Initialise n singleton sets.

        Args:
            n: Number of elements.
        """
        self.parent = list(range(n))

    def find(self, a: int) -> int:
        """
        Find the set root of element a with path compression.

        Args:
            a: Element index.
        Returns:
            Root index of a's set.
        """
        while self.parent[a] != a:
            self.parent[a] = self.parent[self.parent[a]]
            a = self.parent[a]
        return a

    def union(self, a: int, b: int) -> None:
        """
        Merge the sets containing a and b.

        Args:
            a: First element index.
            b: Second element index.
        """
        self.parent[self.find(a)] = self.find(b)


def _endpoint_distance(s1: WireSegment, s2: WireSegment) -> float:
    """
    Smallest distance between any endpoint pair of two segments.

    Args:
        s1: First segment.
        s2: Second segment.
    Returns:
        Minimum endpoint-to-endpoint distance in pixels.
    """
    best = float("inf")
    for p in s1.endpoints:
        for q in s2.endpoints:
            d = ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2) ** 0.5
            best = min(best, d)
    return best


class GraphBuilder:
    """Builds a directed circuit graph from detections and wire segments."""

    def build(
        self,
        detections: list[Detection],
        wire_segments: list[WireSegment],
    ) -> nx.DiGraph:
        """
        Construct a NetworkX DiGraph from gate detections and wire segments.

        Args:
            detections: Gate detections from the detector stage.
            wire_segments: Wire segments from the wire extractor stage.
        Returns:
            A networkx.DiGraph where nodes are gates and edges are wire
            connections carrying 'fromPort'/'toPort' attributes.
        """
        graph = nx.DiGraph()

        components = [d for d in detections if d.class_name != "JUNCTION"]
        for i, det in enumerate(components):
            x1, y1, _, _ = det.box
            graph.add_node(
                f"comp_{i}",
                node_type=CLASS_TO_NODE_TYPE.get(det.class_name, "input"),
                class_name=det.class_name,
                confidence=det.confidence,
                x=float(x1),
                y=float(y1),
            )

        nets = self._cluster_nets(wire_segments)
        for net in nets:
            contacts = self._net_contacts(net, components)
            if len({gate for gate, _, _ in contacts}) < 2:
                continue
            self._add_net_edges(graph, contacts, components)
        return graph

    def _cluster_nets(self, segments: list[WireSegment]) -> list[list[WireSegment]]:
        """
        Group wire segments into electrical nets.

        Args:
            segments: All extracted wire segments.
        Returns:
            List of nets, each a list of segments.
        """
        uf = _UnionFind(len(segments))
        for i in range(len(segments)):
            for j in range(i + 1, len(segments)):
                if _endpoint_distance(segments[i], segments[j]) <= NET_JOIN_DISTANCE:
                    uf.union(i, j)
        nets: dict[int, list[WireSegment]] = {}
        for i, seg in enumerate(segments):
            nets.setdefault(uf.find(i), []).append(seg)
        return list(nets.values())

    def _net_contacts(
        self, net: list[WireSegment], components: list[Detection]
    ) -> list[tuple[int, str, tuple[float, float]]]:
        """
        Find which components a net touches and on which side.

        Args:
            net: Segments belonging to one electrical net.
            components: Non-junction detections in node order.
        Returns:
            List of (component index, 'left'|'right', contact point).
        """
        contacts: list[tuple[int, str, tuple[float, float]]] = []
        seen: set[tuple[int, str, str]] = set()
        for seg in net:
            for px, py in seg.endpoints:
                for idx, det in enumerate(components):
                    x1, y1, x2, y2 = det.box
                    if (
                        x1 - BOX_INFLATE <= px <= x2 + BOX_INFLATE
                        and y1 - BOX_INFLATE <= py <= y2 + BOX_INFLATE
                    ):
                        side = "right" if px >= det.x else "left"
                        # Keep one contact per box quadrant so a gate's two
                        # input ports (top/bottom halves) both survive dedup.
                        half = "top" if py < det.y else "bottom"
                        if (idx, side, half) not in seen:
                            seen.add((idx, side, half))
                            contacts.append((idx, side, (float(px), float(py))))
        return contacts

    def _add_net_edges(
        self,
        graph: nx.DiGraph,
        contacts: list[tuple[int, str, tuple[float, float]]],
        components: list[Detection],
    ) -> None:
        """
        Convert one net's gate contacts into directed edges.

        Args:
            graph: Graph mutated in place.
            contacts: Output of _net_contacts for this net.
            components: Non-junction detections in node order.
        """

        def node_type(idx: int) -> str:
            """Return the ReactFlow node type of component idx."""
            return CLASS_TO_NODE_TYPE.get(components[idx].class_name, "input")

        # Drivers: gates contacted on their output (right) side. Output-style
        # nodes cannot drive a net.
        sources = [
            c for c in contacts if c[1] == "right" and node_type(c[0]) != "output"
        ]
        if not sources:
            # Fallback: the leftmost touched component drives the net.
            leftmost = min(contacts, key=lambda c: components[c[0]].x)
            sources = [leftmost]

        source_ids = {c[0] for c in sources}
        # Consumers: contacted on their input (left) side. Input-style nodes
        # have no input handles and can never be targets.
        targets = [
            c for c in contacts if c[0] not in source_ids and node_type(c[0]) != "input"
        ]

        for tgt_idx, _, tgt_point in targets:
            # When bad segment merging yields several drivers on one net,
            # pick the driver whose contact runs at the closest height.
            src = min(sources, key=lambda c: abs(c[2][1] - tgt_point[1]))
            to_port = self._input_port(components[tgt_idx], tgt_point)
            graph.add_edge(
                f"comp_{src[0]}",
                f"comp_{tgt_idx}",
                fromPort="output",
                toPort=to_port,
            )

    def _input_port(self, det: Detection, contact: tuple[float, float]) -> str | None:
        """
        Choose the frontend input handle id for a connection.

        Args:
            det: Target component detection.
            contact: Wire contact point in pixels.
        Returns:
            'a'/'b' for gates, None for output-style single-handle nodes.
        """
        node_type = CLASS_TO_NODE_TYPE.get(det.class_name, "input")
        if node_type in ("output", "input"):
            return None
        if node_type == "notGate":
            return "a"
        return "a" if contact[1] < det.y else "b"
