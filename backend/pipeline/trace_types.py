"""
Module: trace_types.py
Purpose: Data types shared by the net tracing stage (net_tracer.py and its helpers), the
         net-based graph builder and the exporter: traced components with resolved pins,
         electrical nets, OCR text boxes and the trace result with its diagnostics.
         Kept in one module so every stage speaks the same vocabulary.
"""

from __future__ import annotations

from dataclasses import dataclass, field

Point = tuple[float, float]
Box = tuple[float, float, float, float]


@dataclass(frozen=True)
class Orientation:
    """Symbol orientation: mirror (x -> -x) applied first, then `rotation` degrees clockwise on screen."""

    rotation: int
    mirror: bool


@dataclass
class TracedPin:
    """One terminal of a traced component, resolved to an image point and (when wired) a net."""

    terminal: str
    point: Point | None
    net: str | None = None


@dataclass
class TracedComponent:
    """A detected symbol after pin assignment."""

    id: str
    class_name: str
    node_type: str
    box: Box
    confidence: float
    pins: dict[str, TracedPin] = field(default_factory=dict)
    orientation: Orientation | None = None
    label: str | None = None
    pin_source: str = "keypoints"  # "keypoints" (detector/pose head) or "geometry" (classical fallback)


@dataclass
class TracedNet:
    """An electrical net: the set of component pins it connects ("<component id>:<terminal>")."""

    id: str
    pins: list[str] = field(default_factory=list)
    label: str | None = None


@dataclass(frozen=True)
class TextBox:
    """One OCR text fragment in image pixels."""

    text: str
    box: Box
    confidence: float = 1.0


@dataclass
class TraceDiagnostics:
    """Measurements and counters describing how a trace went (for logs, the API and the bench)."""

    stroke_width: float = 0.0
    symbol_scale: float = 0.0
    erase_margin: float = 0.0
    skeleton_edges: int = 0
    clusters: int = 0
    crossovers_split: int = 0
    junction_merges: int = 0
    unassigned_contacts: int = 0
    unconnected_pins: int = 0
    pass_through_repairs: int = 0
    direct_links: int = 0
    seconds: float = 0.0
    warnings: list[str] = field(default_factory=list)


@dataclass
class TraceResult:
    """Output of the net tracing stage: components with pins, nets and diagnostics."""

    image_size: tuple[int, int]  # (width, height)
    components: list[TracedComponent]
    nets: list[TracedNet]
    texts: list[TextBox] = field(default_factory=list)
    diagnostics: TraceDiagnostics = field(default_factory=TraceDiagnostics)
