"""
Module: graph_builder.py
Purpose: Graph construction stage — converts gate detections and wire segments into a
         directed NetworkX graph representing the circuit topology.
"""

from dataclasses import dataclass

from pipeline.detector import Detection
from pipeline.wire_extractor import WireSegment


@dataclass
class CircuitNode:
    """A single circuit component node in the graph."""

    id: str
    node_type: str
    x: float
    y: float


class GraphBuilder:
    """Builds a directed circuit graph from detections and wire segments."""

    def build(
        self,
        detections: list[Detection],
        wire_segments: list[WireSegment],
    ) -> object:
        """
        Construct a NetworkX DiGraph from gate detections and wire segments.

        Args:
            detections: Gate detections from the detector stage.
            wire_segments: Wire segments from the wire extractor stage.
        Returns:
            A networkx.DiGraph where nodes are gates and edges are wire connections.
        Raises:
            NotImplementedError: Until Phase 3 implementation is complete.
        """
        raise NotImplementedError(
            "Graph building not yet implemented. Complete wire extraction first."
        )
