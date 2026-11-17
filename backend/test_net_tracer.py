"""
Module: test_net_tracer.py
Purpose: Tests for net tracing v2 (pipeline/net_tracer.py and helpers) and the schema-2 exporter on
         small hand-built schematics drawn with the T2 generator's symbol geometry: crossovers with
         and without a junction dot, a branching supply rail, every transistor rotation and mirror,
         3- vs 4-terminal MOSFET symbols, global supply nets, stacked transistors, label reading,
         ruled paper, and the exported nets/edges/legacy connections.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np
import pytest

from data_gen.synth_v2.symbols import orient_points, symbol_geometry
from pipeline.circuit_exporter import CircuitExporter
from pipeline.detector import Detection
from pipeline.graph_builder import GraphBuilder
from pipeline.ink import ink_mask, stroke_width
from pipeline.net_tracer import NetTracer
from pipeline.pin_assignment import ALL_ORIENTATIONS, orient_vector
from pipeline.trace_types import Orientation, TraceResult

PITCH = 20.0
THICK = 2


@dataclass
class Placed:
    """A symbol placed in a test scene (grid anchor, orientation) with its drawn pixel extent and pins."""

    name: str
    cls: str
    variant: str
    box: tuple[float, float, float, float]
    pins: dict[str, tuple[float, float]]


@dataclass
class Scene:
    """A test schematic: a white canvas, symbols, wires and junction dots, drawn like the T2 renderer."""

    width: int = 640
    height: int = 480
    symbols: list[Placed] = field(default_factory=list)
    dots: list[tuple[float, float]] = field(default_factory=list)

    def __post_init__(self) -> None:
        """Create the canvas."""
        self.mask = np.zeros((self.height, self.width), dtype=np.uint8)

    @staticmethod
    def px(pts: np.ndarray) -> np.ndarray:
        """
        Grid units to pixels.

        Args:
            pts: (n, 2) grid points.
        Returns:
            (n, 2) pixel points.
        """
        return (np.asarray(pts, dtype=np.float64) + 0.5) * PITCH

    def _poly(self, pts: np.ndarray) -> None:
        """
        Draw an anti-aliased polyline in pixels.

        Args:
            pts: (n, 2) pixel points.
        """
        cv2.polylines(self.mask, [np.round(pts * 16).astype(np.int32)], False, 255, THICK, cv2.LINE_AA, shift=4)

    def symbol(self, name: str, cls: str, variant: str, anchor: tuple[int, int], rotation: int = 0, mirror: bool = False) -> Placed:
        """
        Draw a symbol and record its box and pin points.

        Args:
            name: Test id.
            cls: Class name.
            variant: Symbol variant.
            anchor: Grid anchor.
            rotation: Clockwise rotation in degrees.
            mirror: Mirror x before rotating.
        Returns:
            The placed symbol.
        """
        geom = symbol_geometry(cls, variant)
        shift = np.array(anchor, dtype=np.float64)
        drawn = []
        for stroke in geom.strokes:
            pts = self.px(orient_points(stroke, rotation, mirror) + shift)
            self._poly(pts)
            drawn.append(pts)
        for fill in geom.fills:
            pts = self.px(orient_points(fill, rotation, mirror) + shift)
            cv2.fillPoly(self.mask, [np.round(pts * 16).astype(np.int32)], 255, cv2.LINE_AA, shift=4)
            drawn.append(pts)
        allpts = np.concatenate(drawn)
        pad = THICK / 2 + 1
        box = (float(allpts[:, 0].min() - pad), float(allpts[:, 1].min() - pad), float(allpts[:, 0].max() + pad), float(allpts[:, 1].max() + pad))
        pins = {t: tuple(float(v) for v in self.px(orient_points(np.array([p], dtype=np.float64), rotation, mirror) + shift)[0]) for t, p in geom.pins.items()}
        placed = Placed(name, cls, variant, box, pins)
        self.symbols.append(placed)
        return placed

    def wire(self, *grid_pts: tuple[float, float]) -> None:
        """
        Draw a wire through grid points.

        Args:
            grid_pts: Polyline vertices in grid units.
        """
        self._poly(self.px(np.array(grid_pts, dtype=np.float64)))

    def dot(self, grid_pt: tuple[float, float], diameter: float = 9.0) -> None:
        """
        Draw a filled junction dot.

        Args:
            grid_pt: Centre in grid units.
            diameter: Dot diameter in pixels.
        """
        c = self.px(np.array([grid_pt]))[0]
        cv2.circle(self.mask, (int(round(c[0] * 16)), int(round(c[1] * 16))), int(round(diameter / 2 * 16)), 255, -1, cv2.LINE_AA, shift=4)
        self.dots.append((float(c[0]), float(c[1])))

    def image(self) -> np.ndarray:
        """
        Render black ink on white paper.

        Returns:
            BGR uint8 image.
        """
        gray = 255 - (self.mask.astype(np.float32) * (235.0 / 255.0))
        return cv2.cvtColor(gray.astype(np.uint8), cv2.COLOR_GRAY2BGR)

    def detections(self, keypoints: bool = True, dots: bool = True) -> list[Detection]:
        """
        Ground-truth detections of the scene.

        Args:
            keypoints: Attach pin keypoints.
            dots: Include junction detections.
        Returns:
            Detections in symbol order, then junctions.
        """
        dets = []
        for s in self.symbols:
            x1, y1, x2, y2 = s.box
            dets.append(Detection(s.cls, 0.9, (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1, keypoints=dict(s.pins) if keypoints else None))
        if dots:
            for x, y in self.dots:
                dets.append(Detection("JUNCTION", 0.9, x, y, 11.0, 11.0))
        return dets


def trace(scene: Scene, keypoints: bool = True, dots: bool = True) -> tuple[TraceResult, dict[str, str]]:
    """
    Trace a scene and map traced component ids back to scene names.

    Args:
        scene: Test scene.
        keypoints: Give the tracer pin keypoints.
        dots: Give the tracer junction detections.
    Returns:
        (trace result, traced id -> scene name).
    """
    result = NetTracer().trace(scene.image(), scene.detections(keypoints, dots), texts=[])
    return result, {c.id: s.name for c, s in zip(result.components, scene.symbols)}


def nets_by_name(result: TraceResult, names: dict[str, str]) -> set[frozenset[str]]:
    """
    Traced nets with at least two pins, in scene names.

    Args:
        result: Trace result.
        names: Traced id -> scene name.
    Returns:
        Set of frozensets of "<name>:<terminal>".
    """
    out = set()
    for net in result.nets:
        pins = frozenset(f"{names[p.partition(':')[0]]}:{p.partition(':')[2]}" for p in net.pins)
        if len(pins) >= 2:
            out.add(pins)
    return out


def crossing_scene(with_dot: bool) -> Scene:
    """
    Two wires crossing at (14, 11): IN1 -> OUT1 horizontally and IN2 -> OUT2 vertically.

    Args:
        with_dot: Draw a junction dot at the crossing.
    Returns:
        The scene.
    """
    sc = Scene()
    sc.symbol("IN1", "INPUT_PORT", "tag", (4, 11))
    sc.symbol("OUT1", "OUTPUT_PORT", "tag", (24, 11))
    sc.symbol("IN2", "INPUT_PORT", "tag", (6, 4))
    sc.symbol("OUT2", "OUTPUT_PORT", "tag", (24, 18))
    sc.wire((4, 11), (24, 11))
    sc.wire((6, 4), (14, 4), (14, 18), (24, 18))
    if with_dot:
        sc.dot((14, 11))
    return sc


@pytest.mark.parametrize("keypoints", [True, False])
def test_crossover_without_dot_keeps_nets_separate(keypoints: bool) -> None:
    """A dotless 4-way crossing is a crossover: the two wires stay two nets."""
    result, names = trace(crossing_scene(with_dot=False), keypoints=keypoints)
    assert nets_by_name(result, names) == {frozenset({"IN1:out", "OUT1:a"}), frozenset({"IN2:out", "OUT2:a"})}
    assert result.diagnostics.crossovers_split == 1


@pytest.mark.parametrize("keypoints", [True, False])
def test_crossing_with_dot_is_one_net(keypoints: bool) -> None:
    """A detected junction dot on a 4-way crossing joins all four wires."""
    result, names = trace(crossing_scene(with_dot=True), keypoints=keypoints)
    assert nets_by_name(result, names) == {frozenset({"IN1:out", "OUT1:a", "IN2:out", "OUT2:a"})}


def test_crossing_with_undetected_dot_falls_back_to_crossover() -> None:
    """Without the JUNCTION detection the dot is ink only, so the 4-way rule decides (crossover)."""
    result, names = trace(crossing_scene(with_dot=True), dots=False)
    assert len(nets_by_name(result, names)) == 2


def test_crossover_beside_a_dot_stays_a_crossover() -> None:
    """A crossover drawn one grid step from a T-junction dot is not swallowed by the dot."""
    sc2 = Scene()
    sc2.symbol("IN1", "INPUT_PORT", "tag", (4, 10))
    sc2.symbol("OUT1", "OUTPUT_PORT", "tag", (26, 10))
    sc2.symbol("OUT2", "OUTPUT_PORT", "tag", (26, 16))
    sc2.symbol("IN2", "INPUT_PORT", "tag", (4, 12))
    sc2.symbol("OUT3", "OUTPUT_PORT", "tag", (26, 13))
    sc2.wire((4, 10), (26, 10))
    sc2.wire((15, 10), (15, 16), (26, 16))
    sc2.dot((15, 10))
    sc2.wire((4, 12), (12, 12), (12, 11), (18, 11), (18, 13), (26, 13))
    result, names = trace(sc2)
    assert nets_by_name(result, names) == {frozenset({"IN1:out", "OUT1:a", "OUT2:a"}), frozenset({"IN2:out", "OUT3:a"})}


def supply_rail_scene() -> Scene:
    """
    A VDD rail branching (with dots) to three PMOS sources, crossed by a dotless input wire.

    Returns:
        The scene.
    """
    sc = Scene(width=800)
    sc.symbol("VDD", "VDD", "bar", (6, 4))
    for i, x in enumerate((12, 18, 24)):
        sc.symbol(f"P{i}", "PMOS", "bubble3", (x, 9))
        sc.symbol(f"Y{i}", "OUTPUT_PORT", "tag", (x + 3, 15))
        sc.wire((x, 11), (x, 15), (x + 3, 15))
        sc.symbol(f"A{i}", "INPUT_PORT", "tag", (x - 4, 18 + i))
        sc.wire((x - 4, 18 + i), (x - 3, 18 + i), (x - 3, 9), (x - 2, 9))
    sc.wire((6, 4), (6, 5), (33, 5))
    for x in (12, 18, 24):
        sc.wire((x, 5), (x, 7))
        sc.dot((x, 5))
    # A signal wire crossing the rail without a dot.
    sc.symbol("CLK", "INPUT_PORT", "tag", (29, 1))
    sc.symbol("CLKO", "OUTPUT_PORT", "tag", (33, 22))
    sc.wire((29, 1), (31, 1), (31, 22), (33, 22))
    return sc


@pytest.mark.parametrize("keypoints", [True, False])
def test_branching_supply_rail(keypoints: bool) -> None:
    """One VDD net holds the supply pin and every branched source; a wire crossing the rail stays separate."""
    result, names = trace(supply_rail_scene(), keypoints=keypoints)
    nets = nets_by_name(result, names)
    assert frozenset({"VDD:pos", "P0:s", "P1:s", "P2:s"}) in nets
    assert frozenset({"CLK:out", "CLKO:a"}) in nets
    for i in range(3):
        assert frozenset({f"P{i}:d", f"Y{i}:a"}) in nets
        assert frozenset({f"A{i}:out", f"P{i}:g"}) in nets


def transistor_scene(rotation: int, mirror: bool, variant: str = "plain3", cls: str = "NMOS") -> Scene:
    """
    One MOSFET whose terminals each run straight out to a port or supply, in a given orientation.

    Args:
        rotation: Clockwise rotation.
        mirror: Mirror flag.
        variant: Symbol variant.
        cls: NMOS or PMOS.
    Returns:
        The scene (drain -> OUT, gate <- IN, source -> GND for NMOS / VDD for PMOS, body -> BODY port).
    """
    sc = Scene()
    anchor = (16, 12)
    placed = sc.symbol("M", cls, variant, anchor, rotation, mirror)
    o = Orientation(rotation, mirror)
    supply = ("GND", "GND", "gnd") if cls == "NMOS" else ("VDD", "VDD", "pos")
    ends = {"d": ("OUT", "OUTPUT_PORT", "a"), "g": ("IN", "INPUT_PORT", "out"), "s": supply, "b": ("BODY", "OUTPUT_PORT", "a")}
    canonical = {"d": (0, -2), "g": (-2, 0), "s": (0, 2), "b": (1, 0)} if cls == "NMOS" else {"s": (0, -2), "g": (-2, 0), "d": (0, 2), "b": (1, 0)}
    for term in placed.pins:
        dx, dy = (int(round(v)) for v in orient_vector(canonical[term], o))
        unit = (int(np.sign(dx)), int(np.sign(dy)))
        start = (anchor[0] + dx, anchor[1] + dy)
        end = (start[0] + 4 * unit[0], start[1] + 4 * unit[1])
        sc.wire(start, end)
        name, ecls, _ = ends[term]
        # Rotate each end symbol so its pin faces the wire.
        if ecls in ("VDD", "GND"):
            facing = {(0, 1): 0, (-1, 0): 90, (0, -1): 180, (1, 0): 270} if ecls == "VDD" else {(0, -1): 0, (1, 0): 90, (0, 1): 180, (-1, 0): 270}
            sc.symbol(name, ecls, "bar" if ecls == "VDD" else "bars", end, facing[(-unit[0], -unit[1])])
        else:
            base = (1, 0) if ecls == "INPUT_PORT" else (-1, 0)
            rot = next(r for r in (0, 90, 180, 270) if tuple(int(round(v)) for v in orient_vector(base, Orientation(r, False))) == (-unit[0], -unit[1]))
            sc.symbol(name, ecls, "tag", end, rot)
    return sc


@pytest.mark.parametrize("orientation", ALL_ORIENTATIONS, ids=lambda o: f"r{o.rotation}{'m' if o.mirror else ''}")
@pytest.mark.parametrize("keypoints", [True, False])
def test_rotated_mirrored_transistor(orientation: Orientation, keypoints: bool) -> None:
    """Every rotation and mirror of an NMOS resolves gate, drain and source; keypoint mode also recovers the orientation."""
    sc = transistor_scene(orientation.rotation, orientation.mirror)
    result, names = trace(sc, keypoints=keypoints)
    assert nets_by_name(result, names) == {frozenset({"M:d", "OUT:a"}), frozenset({"M:g", "IN:out"}), frozenset({"M:s", "GND:gnd"})}
    mos = result.components[0]
    assert mos.orientation == orientation


@pytest.mark.parametrize(
    ("cls", "variant", "four"),
    [
        ("NMOS", "plain3", False),
        ("NMOS", "arrow3", False),
        ("NMOS", "dashed3", False),
        ("NMOS", "body4", True),
        ("PMOS", "bubble3", False),
        ("PMOS", "arrow3", False),
        ("PMOS", "bubble4", True),
        ("PMOS", "body4", True),
    ],
)
@pytest.mark.parametrize("keypoints", [True, False])
def test_three_vs_four_terminal_symbols(cls: str, variant: str, four: bool, keypoints: bool) -> None:
    """3-terminal symbols get d/g/s; 4-terminal symbols also get the body pin on its own net."""
    sc = transistor_scene(90, False, variant, cls)
    result, names = trace(sc, keypoints=keypoints)
    nets = nets_by_name(result, names)
    supply = "GND:gnd" if cls == "NMOS" else "VDD:pos"
    assert frozenset({"M:s", supply}) in nets
    assert frozenset({"M:d", "OUT:a"}) in nets
    assert frozenset({"M:g", "IN:out"}) in nets
    assert (frozenset({"M:b", "BODY:a"}) in nets) == four
    assert ("b" in result.components[0].pins) == four


def test_separate_supply_symbols_share_one_net() -> None:
    """Two unconnected GND symbols are one global ground net."""
    sc = Scene()
    sc.symbol("IN1", "INPUT_PORT", "tag", (6, 6))
    sc.symbol("G1", "GND", "bars", (10, 8))
    sc.wire((6, 6), (10, 6), (10, 8))
    sc.symbol("IN2", "INPUT_PORT", "tag", (16, 14))
    sc.symbol("G2", "GND", "triangle", (20, 16))
    sc.wire((16, 14), (20, 14), (20, 16))
    result, names = trace(sc)
    assert nets_by_name(result, names) == {frozenset({"IN1:out", "G1:gnd", "IN2:out", "G2:gnd"})}


def test_stacked_transistors_with_tiny_link() -> None:
    """Two series NMOS whose shared wire is shorter than the erase margins still connect drain to source."""
    sc = Scene()
    sc.symbol("M1", "NMOS", "plain3", (16, 8))
    sc.symbol("M2", "NMOS", "plain3", (16, 12.3))
    sc.wire((16, 10), (16, 10.3))
    sc.symbol("OUT", "OUTPUT_PORT", "tag", (20, 4))
    sc.wire((16, 6), (16, 4), (20, 4))
    sc.symbol("GND", "GND", "bars", (16, 17))
    sc.wire((16, 14.3), (16, 17))
    for name, y in (("A", 8), ("B", 12.3)):
        sc.symbol(name, "INPUT_PORT", "tag", (10, y))
        sc.wire((10, y), (14, y))
    result, names = trace(sc)
    assert frozenset({"M1:s", "M2:d"}) in nets_by_name(result, names)


def test_ink_ignores_ruled_paper_lines() -> None:
    """Faint ruled-paper lines are not ink; pen strokes are, and the stroke width is measured."""
    img = np.full((200, 300, 3), (238, 242, 245), dtype=np.uint8)
    for y in range(10, 200, 25):
        cv2.line(img, (0, y), (299, y), (205, 185, 165), 1)
    cv2.line(img, (20, 100), (280, 100), (25, 25, 25), 3)
    mask = ink_mask(img)
    assert mask[100, 150] and not mask[35, 150]
    assert abs(stroke_width(mask) - int(mask[:, 150].sum())) <= 1.0


def test_reads_port_labels_beside_symbols() -> None:
    """The label window beside each port is cropped and recognised; nets take their port's name."""
    sc = crossing_scene(with_dot=False)
    img = sc.image()
    cv2.putText(img, "A", (int(sc.symbols[0].box[0]) - 26, int(sc.symbols[0].box[3]) - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (20, 20, 20), 2)
    seen: list[tuple[int, int]] = []

    def fake_ocr(crop: np.ndarray) -> tuple[str, float]:
        """Recogniser stub that records crop sizes."""
        seen.append(crop.shape[:2])
        return ("A", 0.99)

    result = NetTracer(ocr=fake_ocr).trace(img, sc.detections(), texts=None)
    in1 = result.components[0]
    assert in1.label == "A"
    assert len(seen) == 1 and seen[0][0] < 40
    net = next(n for n in result.nets if f"{in1.id}:out" in n.pins)
    assert net.label == "A"


def test_export_schema_v2_for_cmos_inverter() -> None:
    """The exporter emits typed components with pins, undirected nets and ReactFlow edges with t:/s: handles."""
    sc = Scene()
    sc.symbol("VDD", "VDD", "bar", (16, 3))
    sc.symbol("MP", "PMOS", "bubble3", (16, 7))
    sc.symbol("MN", "NMOS", "plain3", (16, 13))
    sc.symbol("GND", "GND", "bars", (16, 17))
    sc.symbol("A", "INPUT_PORT", "tag", (8, 10))
    sc.symbol("Y", "OUTPUT_PORT", "tag", (22, 10))
    sc.wire((16, 3), (16, 5))
    sc.wire((16, 9), (16, 11))
    sc.wire((16, 15), (16, 17))
    sc.wire((16, 10), (22, 10))
    sc.dot((16, 10))
    sc.wire((8, 10), (11, 10), (11, 7), (14, 7))
    sc.wire((11, 10), (11, 13), (14, 13))
    sc.dot((11, 10))
    result, names = trace(sc)
    payload = CircuitExporter().export(GraphBuilder().build(result))
    assert payload["schema_version"] == 2
    types = {names[c["id"]]: c["type"] for c in payload["components"]}
    assert types == {"VDD": "vsource", "MP": "pmos", "MN": "nmos", "GND": "ground", "A": "input", "Y": "output"}
    by_name = {names[c["id"]]: c for c in payload["components"]}
    assert set(by_name["MN"]["pins"]) == {"d", "g", "s"}
    nets = {frozenset(f"{names[p.split(':')[0]]}:{p.split(':')[1]}" for p in n["pins"]) for n in payload["nets"]}
    assert nets == {
        frozenset({"VDD:pos", "MP:s"}),
        frozenset({"MP:d", "MN:d", "Y:a"}),
        frozenset({"A:out", "MP:g", "MN:g"}),
        frozenset({"MN:s", "GND:gnd"}),
    }
    ids = {v: k for k, v in names.items()}
    gate_edges = [e for e in payload["edges"] if e["source"] == ids["A"]]
    assert {(e["target"], e["targetHandle"]) for e in gate_edges} == {(ids["MP"], "t:g"), (ids["MN"], "t:g")}
    assert all(e["sourceHandle"] is None for e in gate_edges)
    supply_edge = next(e for e in payload["edges"] if ids["VDD"] in (e["source"], e["target"]))
    assert {supply_edge["sourceHandle"], supply_edge["targetHandle"]} == {"s:pos", "t:s"} or {supply_edge["sourceHandle"], supply_edge["targetHandle"]} == {"s:s", "t:pos"}
    assert payload["connections"] == []
    assert all(c["library_cell"] is None for c in payload["components"])


def test_export_gate_circuit_keeps_legacy_connections() -> None:
    """Gate-level circuits still produce the schema-1 directed connections the current importer reads."""
    sc = Scene()
    sc.symbol("U", "NAND", "ansi", (14, 10))
    sc.symbol("A", "INPUT_PORT", "tag", (6, 9))
    sc.symbol("B", "INPUT_PORT", "tag", (6, 11))
    sc.symbol("Y", "OUTPUT_PORT", "tag", (22, 10))
    sc.wire((6, 9), (13, 9))
    sc.wire((6, 11), (13, 11))
    sc.wire((18, 10), (22, 10))
    for keypoints in (True, False):
        result, names = trace(sc, keypoints=keypoints)
        payload = CircuitExporter().export(GraphBuilder().build(result))
        ids = {v: k for k, v in names.items()}
        conns = {(names[c["from"]], names[c["to"]], c["fromPort"], c["toPort"]) for c in payload["connections"]}
        assert conns == {("A", "U", "output", "a"), ("B", "U", "output", "b"), ("U", "Y", "output", None)}
        nand = next(c for c in payload["components"] if c["id"] == ids["U"])
        assert nand["library_cell"] == {"id": "std-nand", "pins": {"a": "a", "b": "b", "out": "out"}}


def test_legacy_alias_classes_are_traced() -> None:
    """Old gate-era class names (SWITCH, LED) resolve through the aliases."""
    sc = Scene()
    sc.symbol("S", "INPUT_PORT", "tag", (6, 8))
    sc.symbol("L", "OUTPUT_PORT", "tag", (16, 8))
    sc.wire((6, 8), (16, 8))
    dets = sc.detections()
    dets[0].class_name, dets[1].class_name = "SWITCH", "LED"
    result = NetTracer().trace(sc.image(), dets, texts=[])
    assert [c.node_type for c in result.components] == ["input", "output"]
    assert len(result.nets) == 1 and len(result.nets[0].pins) == 2


def test_unknown_class_is_reported_not_traced() -> None:
    """A class outside ml/classes.yaml is skipped with a warning."""
    sc = crossing_scene(with_dot=False)
    dets = sc.detections() + [Detection("TOASTER", 0.9, 50, 50, 10, 10)]
    result = NetTracer().trace(sc.image(), dets, texts=[])
    assert any("TOASTER" in w for w in result.diagnostics.warnings)
    assert len(result.components) == 4
