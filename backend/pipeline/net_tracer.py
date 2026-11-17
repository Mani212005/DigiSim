"""
Module: net_tracer.py
Purpose: Net tracing v2 - the wire extraction stage of the image-to-circuit pipeline. Classical
         CV only (no neural networks, per AGENTS.md). Turns a schematic image plus symbol
         detections into components with resolved pins and undirected electrical nets:
           1. binarise ink against the paper background (pipeline/ink.py);
           2. erase every symbol body (box plus a size-relative margin), keep junction dots;
           3. skeletonise the remaining wire ink into a pixel graph and resolve it into nets:
              junction dots connect, dotless 4-way crossings are crossovers (straight-through
              wires only), every other branch point connects (pipeline/skeleton_graph.py);
           4. wire ends stopping at a symbol box are its contacts; contacts become terminals via
              the detector's pin keypoints, or the classical geometry rules and orientation
              head when there are none (pipeline/pin_assignment.py);
           5. OCR text attaches to ports, supplies, devices and nets (pipeline/label_attach.py).
         Every threshold scales with the measured stroke width and the median symbol size, so
         the same settings work from 500 px to 2000 px images.
"""

from __future__ import annotations

import itertools
import time
from collections.abc import Callable
from dataclasses import dataclass

import cv2
import numpy as np

from pipeline.class_map import CLASS_TERMINALS, CLASS_TO_NODE_TYPE
from pipeline.detector import Detection, canonical_class
from pipeline.ink import ink_mask, stroke_width
from pipeline.label_attach import TextRecognizer, attach_labels, read_labels
from pipeline.pin_assignment import (
    DS_UNRESOLVED,
    MOSFET_CLASSES,
    Contact,
    assign_by_geometry,
    assign_by_keypoints,
    estimate_orientation,
    resolve_drain_source,
)
from pipeline.skeleton_graph import SkeletonGraph, UnionFind, build_skeleton_graph, edge_length, resolve_connectivity
from pipeline.trace_types import Box, Point, TextBox, TracedComponent, TraceDiagnostics, TracedNet, TracedPin, TraceResult

# Designator prefix per frontend node type, numbered in reading order (top-to-bottom, left-to-right).
DESIGNATOR_PREFIX: dict[str, str] = {
    "nmos": "MN",
    "pmos": "MP",
    "vsource": "VDD",
    "ground": "GND",
    "input": "IN",
    "output": "OUT",
    "resistor": "R",
    "capacitor": "C",
    "inductor": "L",
    "bjtNpn": "Q",
    "bjtPnp": "Q",
    "clockSource": "CLK",
}
GATE_DESIGNATOR = "U"
# Share of samples along a pin-to-pin segment that must be ink for a direct link.
DIRECT_LINK_MIN_INK = 0.8
# Supply classes and the terminal their symbol draws; all symbols of one class share a global net.
SUPPLY_TERMINAL: dict[str, str] = {"VDD": "pos", "GND": "gnd"}


@dataclass(frozen=True)
class TraceConfig:
    """Size-relative tracing thresholds (multiples of the stroke width s and the median symbol size)."""

    erase_margin_stroke: float = 1.0  # symbol erase margin = a*s + b*symbol size
    erase_margin_symbol: float = 0.06
    contact_stroke: float = 1.5  # a wire end within c*s + 2 px of an erased box is a contact
    merge_radius_stroke: float = 0.5  # branch pixels within this many strokes are one cluster
    reach_stroke: float = 4.0  # wire directions are measured over this many strokes
    spur_stroke: float = 3.0  # dangling runs shorter than this many strokes are spurs
    junction_pad_stroke: float = 0.5  # junction boxes grow by this many strokes
    pass_through_cos: float = 0.85  # leftover contacts this collinear and opposite are one wire
    label_reach_symbol: float = 0.8  # text within this many symbol sizes labels a symbol or net
    close_symbol: float = 0.1  # closing kernel for the wire mask, as a fraction of the symbol size
    min_blob_strokes: float = 1.0  # ink specks spanning less than k*s px either way are noise
    direct_link_strokes: float = 6.0  # unwired facing pins closer than 2*margin + k*s, joined by ink, connect


def _inflate(box: Box, margin: float, width: int, height: int) -> tuple[int, int, int, int]:
    """
    Integer pixel window of a box grown by a margin and clipped to the image.

    Args:
        box: (x1, y1, x2, y2).
        margin: Growth on every side in pixels.
        width: Image width.
        height: Image height.
    Returns:
        (xa, ya, xb, yb) half-open pixel window.
    """
    return (
        max(0, int(np.floor(box[0] - margin))),
        max(0, int(np.floor(box[1] - margin))),
        min(width, int(np.ceil(box[2] + margin)) + 1),
        min(height, int(np.ceil(box[3] + margin)) + 1),
    )


def _rect_distances(point: Point, rects: np.ndarray) -> np.ndarray:
    """
    Distance from a point to each rectangle (0 inside).

    Args:
        point: (x, y).
        rects: (n, 4) array of (xa, ya, xb, yb).
    Returns:
        (n,) distances.
    """
    dx = np.maximum(0.0, np.maximum(rects[:, 0] - point[0], point[0] - (rects[:, 2] - 1)))
    dy = np.maximum(0.0, np.maximum(rects[:, 1] - point[1], point[1] - (rects[:, 3] - 1)))
    return np.hypot(dx, dy)


def _ink_fraction(ink: np.ndarray, a: Point, b: Point) -> float:
    """
    Fraction of points along a segment that fall on ink (a one-pixel tolerance band).

    Args:
        ink: Bool ink mask.
        a: Segment start (x, y).
        b: Segment end (x, y).
    Returns:
        Share in [0, 1].
    """
    h, w = ink.shape
    n = max(2, int(np.hypot(b[0] - a[0], b[1] - a[1])))
    xs = np.clip(np.round(np.linspace(a[0], b[0], n)).astype(int), 0, w - 1)
    ys = np.clip(np.round(np.linspace(a[1], b[1], n)).astype(int), 0, h - 1)
    near = np.zeros(n, dtype=bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            near |= ink[np.clip(ys + dy, 0, h - 1), np.clip(xs + dx, 0, w - 1)]
    return float(near.mean())


def _remove_small_blobs(mask: np.ndarray, min_extent: float) -> np.ndarray:
    """
    Drop connected ink specks whose bounding box is shorter than min_extent on both sides.

    Args:
        mask: Bool mask.
        min_extent: Smallest kept bounding-box side in pixels (short wire stubs are long in one direction).
    Returns:
        Cleaned bool mask.
    """
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    keep = np.zeros(n, dtype=bool)
    keep[1:] = np.maximum(stats[1:, cv2.CC_STAT_WIDTH], stats[1:, cv2.CC_STAT_HEIGHT]) >= min_extent
    return keep[labels]


class NetTracer:
    """Classical net tracer: image + symbol detections -> components with pins and nets."""

    def __init__(self, config: TraceConfig | None = None, ocr: TextRecognizer | None = None) -> None:
        """
        Create a tracer.

        Args:
            config: Thresholds (defaults to TraceConfig()).
            ocr: Recogniser for label crops (None skips OCR; pass label_attach.rapidocr_recognizer for real OCR).
        """
        self.config = config or TraceConfig()
        self.ocr = ocr

    def trace(self, image: np.ndarray, detections: list[Detection], texts: list[TextBox] | None = None) -> TraceResult:
        """
        Trace nets and assign pins for one schematic image.

        Args:
            image: BGR uint8 image.
            detections: Symbol detections (any class of ml/classes.yaml, legacy aliases accepted).
            texts: Pre-read text boxes; when None the configured recogniser (if any) reads the port and supply labels.
        Returns:
            TraceResult with components (ids are designators like MN1, MP2, VDD1, U3), nets and diagnostics.
        """
        start = time.perf_counter()
        cfg = self.config
        diag = TraceDiagnostics()
        height, width = image.shape[:2]

        symbols: list[tuple[str, Detection]] = []
        junction_boxes: list[Box] = []
        for det in detections:
            cls = canonical_class(det.class_name)
            if cls == "JUNCTION":
                junction_boxes.append(det.box)
            elif cls in CLASS_TERMINALS:
                symbols.append((cls, det))
            else:
                diag.warnings.append(f"unknown class {det.class_name!r} ignored")

        ink = ink_mask(image)
        s = stroke_width(ink)
        sizes = [min(d.width, d.height) for _, d in symbols]
        scale = float(np.median(sizes)) if sizes else 0.03 * max(width, height)
        margin = cfg.erase_margin_stroke * s + cfg.erase_margin_symbol * scale
        diag.stroke_width, diag.symbol_scale, diag.erase_margin = round(s, 3), round(scale, 3), round(margin, 3)

        wire = ink.copy()
        rects = np.array([_inflate(d.box, margin, width, height) for _, d in symbols], dtype=np.float64).reshape(-1, 4)
        for xa, ya, xb, yb in rects.astype(int):
            wire[ya:yb, xa:xb] = False
        # Close small gaps and merge the doubled passes of sketchy strokes into one stroke before thinning.
        k = max(3, int(round(cfg.close_symbol * scale)) | 1)
        wire = cv2.morphologyEx(wire.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))).astype(bool)
        for xa, ya, xb, yb in rects.astype(int):
            wire[ya:yb, xa:xb] = False
        wire = _remove_small_blobs(wire, cfg.min_blob_strokes * s)

        pad = cfg.junction_pad_stroke * s
        jboxes = [(b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad) for b in junction_boxes]
        reach = cfg.reach_stroke * s
        graph = build_skeleton_graph(wire, jboxes, merge_radius=max(1.5, cfg.merge_radius_stroke * s), reach=reach)
        diag.skeleton_edges, diag.clusters = graph.n_edges, graph.n_clusters

        contacts = self._contacts(graph, rects, cfg.contact_stroke * s + 2.0)
        spurs = self._spurs(graph, contacts, cfg.spur_stroke * s)
        uf, diag.crossovers_split, diag.junction_merges = resolve_connectivity(graph, spurs, reach)

        by_symbol: dict[int, list[Contact]] = {}
        for c in contacts:
            by_symbol.setdefault(c.symbol, []).append(c)

        components = self._components(symbols)
        assigned: list[dict[str, Contact]] = []
        for k, (cls, det) in enumerate(symbols):
            comp = components[k]
            mine = by_symbol.get(k, [])
            if det.keypoints:
                kps = {t: p for t, p in det.keypoints.items() if t in CLASS_TERMINALS[cls]}
                terms = assign_by_keypoints(kps, mine, det.box, margin, s)
                for t, p in kps.items():
                    if t not in terms:
                        found = self._nearest_wire(graph, p, rects[k], margin + 3.0 * s + 0.3 * min(det.width, det.height))
                        if found is not None:
                            terms[t] = Contact(k, p, found, (0.0, 0.0))
                comp.pin_source = "keypoints"
            else:
                terms = assign_by_geometry(cls, CLASS_TERMINALS[cls], mine, det.box, ink)
                comp.pin_source = "geometry"
            assigned.append(terms)
            used = {id(c) for c in terms.values()}
            leftovers = [c for c in mine if id(c) not in used]
            diag.unassigned_contacts += len(leftovers)
            diag.pass_through_repairs += self._repair_pass_through(leftovers, uf, cfg.pass_through_cos)

        net_of_root: dict[int, str] = {}
        counter = itertools.count()

        def fresh_net() -> str:
            """A new, unused net id."""
            return f"n{next(counter)}"

        def net_for(edge: int) -> str:
            """Stable net id for the union-find root of an edge."""
            root = uf.find(edge)
            if root not in net_of_root:
                net_of_root[root] = fresh_net()
            return net_of_root[root]

        for k, (cls, det) in enumerate(symbols):
            comp = components[k]
            for t, c in assigned[k].items():
                point = det.keypoints.get(t, c.point) if det.keypoints else c.point
                comp.pins[t] = TracedPin(terminal=t, point=(round(float(point[0]), 2), round(float(point[1]), 2)), net=net_for(c.edge))
        for k, (cls, det) in enumerate(symbols):
            comp = components[k]
            for t in CLASS_TERMINALS[cls]:
                if t not in comp.pins and det.keypoints and t in det.keypoints:
                    comp.pins[t] = TracedPin(terminal=t, point=det.keypoints[t], net=None)
        diag.direct_links = self._link_facing_pins(components, ink, 2.0 * margin + cfg.direct_link_strokes * s, fresh_net)
        self._merge_supplies(symbols, components)
        self._resolve_mosfets(symbols, components)
        for k, (cls, det) in enumerate(symbols):
            comp = components[k]
            comp.orientation = estimate_orientation(cls, det.box, {t: p.point for t, p in comp.pins.items() if p.point is not None})
            diag.unconnected_pins += sum(1 for p in comp.pins.values() if p.net is None)

        nets, renamed = self._nets(components)
        if texts is None and self.ocr is not None:
            texts = read_labels(image, ink, components, self.ocr)
        texts = texts or []
        pixels = {renamed[n]: px for n, px in self._net_pixels(graph, uf, net_of_root).items() if n in renamed} if texts else {}
        attach_labels(texts, components, nets, pixels, cfg.label_reach_symbol * scale)
        diag.seconds = round(time.perf_counter() - start, 4)
        return TraceResult(image_size=(width, height), components=components, nets=nets, texts=texts, diagnostics=diag)

    @staticmethod
    def _contacts(graph: SkeletonGraph, rects: np.ndarray, reach: float) -> list[Contact]:
        """
        Wire ends that stop at an erased symbol box.

        Args:
            graph: Skeleton graph.
            rects: (n, 4) erased symbol windows.
            reach: Largest end-to-box distance of a contact.
        Returns:
            Contacts (each end belongs to its nearest box only).
        """
        if len(rects) == 0:
            return []
        out: list[Contact] = []
        for ep in graph.endpoints:
            d = _rect_distances(ep.point, rects)
            k = int(np.argmin(d))
            if d[k] <= reach:
                out.append(Contact(symbol=k, point=ep.point, edge=ep.edge, direction=ep.direction, length=edge_length(graph, ep.edge)))
        return out

    @staticmethod
    def _spurs(graph: SkeletonGraph, contacts: list[Contact], max_len: float) -> set[int]:
        """
        Short dangling edges that are thinning artefacts, not wires.

        Args:
            graph: Skeleton graph.
            contacts: Contacts (their edges are never spurs).
            max_len: Longest spur in pixels.
        Returns:
            Edge ids to ignore when counting a cluster's wires.
        """
        contact_edges = {c.edge for c in contacts}
        dangling = {ep.edge for ep in graph.endpoints}
        return {e for e in dangling if e not in contact_edges and edge_length(graph, e) < max_len}

    @staticmethod
    def _nearest_wire(graph: SkeletonGraph, point: Point, rect: np.ndarray, radius: float) -> int | None:
        """
        Edge whose skeleton passes closest to a keypoint, outside the symbol's erased window.

        Args:
            graph: Skeleton graph.
            point: Keypoint (x, y).
            rect: The symbol's erased window (xa, ya, xb, yb).
            radius: Search radius in pixels.
        Returns:
            Edge id, or None when no wire is within the radius.
        """
        h, w = graph.edge_labels.shape
        r = int(np.ceil(radius))
        xa, ya = max(0, int(point[0]) - r), max(0, int(point[1]) - r)
        xb, yb = min(w, int(point[0]) + r + 1), min(h, int(point[1]) + r + 1)
        window = graph.edge_labels[ya:yb, xa:xb]
        ys, xs = np.nonzero(window)
        if ys.size == 0:
            return None
        xs, ys = xs + xa, ys + ya
        d = np.hypot(xs - point[0], ys - point[1])
        inside = (xs >= rect[0]) & (xs < rect[2]) & (ys >= rect[1]) & (ys < rect[3])
        d[inside] = np.inf
        i = int(np.argmin(d))
        return int(graph.edge_labels[ys[i], xs[i]]) if d[i] <= radius else None

    @staticmethod
    def _repair_pass_through(leftovers: list[Contact], uf: UnionFind, min_cos: float) -> int:
        """
        Reconnect a wire that runs past a symbol and was cut by its erased box (two collinear, opposite leftover ends).

        Args:
            leftovers: Contacts of one symbol not used by any terminal.
            uf: Edge union-find (mutated).
            min_cos: Required collinearity (|cos| of the directions and of the gap line).
        Returns:
            Number of repairs made.
        """
        repairs = 0
        used: set[int] = set()
        for i in range(len(leftovers)):
            for j in range(i + 1, len(leftovers)):
                if i in used or j in used:
                    continue
                a, b = leftovers[i], leftovers[j]
                facing = a.direction[0] * b.direction[0] + a.direction[1] * b.direction[1]
                gap = np.array(b.point) - np.array(a.point)
                n = float(np.hypot(*gap))
                if n < 1e-6 or facing > -min_cos:
                    continue
                along = abs(gap[0] * a.direction[0] + gap[1] * a.direction[1]) / n
                if along >= min_cos:
                    uf.union(a.edge, b.edge)
                    used.update((i, j))
                    repairs += 1
        return repairs

    @staticmethod
    def _components(symbols: list[tuple[str, Detection]]) -> list[TracedComponent]:
        """
        Create components with designator ids in reading order.

        Args:
            symbols: (canonical class, detection) per non-junction symbol.
        Returns:
            Components in the same order as symbols.
        """
        order = sorted(range(len(symbols)), key=lambda k: (round(symbols[k][1].box[1] / 8.0), symbols[k][1].box[0]))
        counters: dict[str, int] = {}
        ids: dict[int, str] = {}
        for k in order:
            node_type = CLASS_TO_NODE_TYPE[symbols[k][0]]
            prefix = DESIGNATOR_PREFIX.get(node_type, GATE_DESIGNATOR)
            counters[prefix] = counters.get(prefix, 0) + 1
            ids[k] = f"{prefix}{counters[prefix]}"
        return [
            TracedComponent(
                id=ids[k],
                class_name=cls,
                node_type=CLASS_TO_NODE_TYPE[cls],
                box=tuple(round(float(v), 2) for v in det.box),
                confidence=round(float(det.confidence), 4),
            )
            for k, (cls, det) in enumerate(symbols)
        ]

    @staticmethod
    def _link_facing_pins(components: list[TracedComponent], ink: np.ndarray, max_gap: float, fresh_net: Callable[[], str]) -> int:
        """
        Connect two unwired pins of different symbols that face each other across a tiny gap drawn in ink.

        Stacked transistors are often joined by a wire shorter than the two erase margins, so no skeleton is
        left between them; the keypoints still sit on either end of that stub.

        Args:
            components: Components with pins (pin nets are set in place).
            ink: Bool ink mask before symbol erasure.
            max_gap: Largest pin-to-pin distance linked.
            fresh_net: Allocator for new net ids.
        Returns:
            Number of links made.
        """
        loose = [(c, p) for c in components for p in c.pins.values() if p.net is None and p.point is not None]
        links = 0
        taken: set[int] = set()
        pairs = sorted(
            ((float(np.hypot(a[1].point[0] - b[1].point[0], a[1].point[1] - b[1].point[1])), i, j) for i, a in enumerate(loose) for j, b in enumerate(loose) if i < j and a[0] is not b[0]),
        )
        for gap, i, j in pairs:
            if gap > max_gap or i in taken or j in taken:
                continue
            if _ink_fraction(ink, loose[i][1].point, loose[j][1].point) < DIRECT_LINK_MIN_INK:
                continue
            net = fresh_net()
            loose[i][1].net = loose[j][1].net = net
            taken.update((i, j))
            links += 1
        return links

    @staticmethod
    def _merge_supplies(symbols: list[tuple[str, Detection]], components: list[TracedComponent]) -> None:
        """
        Supply symbols are global: every VDD symbol is one net and every GND symbol is one net, wired or not.

        Args:
            symbols: (canonical class, detection) per symbol.
            components: Components with pins (pin nets are rewritten in place).
        """
        for cls, terminal in SUPPLY_TERMINAL.items():
            pins = [comp.pins[terminal] for (c, _), comp in zip(symbols, components) if c == cls and terminal in comp.pins]
            nets = sorted({p.net for p in pins if p.net is not None}, key=lambda n: int(n[1:]))
            target = nets[0] if nets else f"n_{cls.lower()}"
            merged = set(nets)
            for comp in components:
                for pin in comp.pins.values():
                    if pin.net in merged:
                        pin.net = target
            for pin in pins:
                pin.net = target

    @staticmethod
    def _resolve_mosfets(symbols: list[tuple[str, Detection]], components: list[TracedComponent]) -> None:
        """
        Rename geometry-mode MOSFET channel placeholders (ds0/ds1) to drain/source electrically.

        Args:
            symbols: (canonical class, detection) per symbol.
            components: Components with pins (mutated).
        """
        pending = []
        supply: dict[str, set[str]] = {"NMOS": set(), "PMOS": set()}
        for (cls, _), comp in zip(symbols, components):
            for pin in comp.pins.values():
                if pin.net and cls == "GND":
                    supply["NMOS"].add(pin.net)
                if pin.net and cls == "VDD":
                    supply["PMOS"].add(pin.net)
            if cls in MOSFET_CLASSES and DS_UNRESOLVED[0] in comp.pins:
                p0, p1 = comp.pins[DS_UNRESOLVED[0]], comp.pins[DS_UNRESOLVED[1]]
                pending.append((comp.id, cls, p0.net, p1.net, p0.point, p1.point))
        inputs = {p.net for (cls, _), comp in zip(symbols, components) if cls == "INPUT_PORT" for p in comp.pins.values() if p.net}
        decisions = resolve_drain_source(pending, supply, inputs)
        for comp in components:
            if comp.id in decisions:
                t0, t1 = decisions[comp.id]
                p0, p1 = comp.pins.pop(DS_UNRESOLVED[0]), comp.pins.pop(DS_UNRESOLVED[1])
                p0.terminal, p1.terminal = t0, t1
                comp.pins[t0], comp.pins[t1] = p0, p1

    @staticmethod
    def _nets(components: list[TracedComponent]) -> tuple[list[TracedNet], dict[str, str]]:
        """
        Collect nets from component pins, renumbered n0.. by their first pin.

        Args:
            components: Components with pins (pin nets are renamed in place).
        Returns:
            (nets with sorted pin lists, old net id -> new net id).
        """
        groups: dict[str, list[str]] = {}
        for comp in components:
            for t, pin in sorted(comp.pins.items()):
                if pin.net is not None:
                    groups.setdefault(pin.net, []).append(f"{comp.id}:{t}")
        ordered = sorted(groups.items(), key=lambda kv: sorted(kv[1])[0])
        rename = {old: f"n{i}" for i, (old, _) in enumerate(ordered)}
        for comp in components:
            for pin in comp.pins.values():
                if pin.net is not None:
                    pin.net = rename[pin.net]
        return [TracedNet(id=rename[old], pins=sorted(pins)) for old, pins in ordered], rename

    @staticmethod
    def _net_pixels(graph: SkeletonGraph, uf: UnionFind, net_of_root: dict[int, str]) -> dict[str, np.ndarray]:
        """
        Wire pixels per (pre-renumbering) net id, for text-to-net attachment.

        Args:
            graph: Skeleton graph.
            uf: Edge union-find.
            net_of_root: Union-find root -> net id assigned during pin resolution.
        Returns:
            Net id -> (n, 2) pixels.
        """
        acc: dict[str, list[np.ndarray]] = {}
        for e, pixels in graph.edge_pixels.items():
            net = net_of_root.get(uf.find(e))
            if net is not None:
                acc.setdefault(net, []).append(pixels)
        return {n: np.concatenate(p, axis=0) for n, p in acc.items()}
