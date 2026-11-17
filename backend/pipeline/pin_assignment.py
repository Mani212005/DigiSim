"""
Module: pin_assignment.py
Purpose: Pin assignment for the net tracer. A symbol's "contacts" are the wire ends that stop
         at its (erased) box; this module decides which terminal each contact is:
           - keypoint mode: the detector (a T7 pose/keypoint head, or ground truth in the bench)
             supplies one image point per terminal and contacts are matched to them by an
             optimal assignment with a size-relative distance gate;
           - geometry mode (classical fallback, no keypoints): terminals follow from the symbol
             family's contact layout (MOSFET: drain/source are the farthest-apart pair and the
             gate is the remaining contact farther from that line; gates: inputs share a side,
             the output is opposite; single-pin symbols take their one wire). MOSFET drain vs
             source is settled afterwards electrically (resolve_drain_source).
         Also estimates each symbol's orientation (4 rotations x mirror, the generator's
         convention) from its resolved pin points: the classical orientation head.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from itertools import combinations

import numpy as np
from scipy.optimize import linear_sum_assignment

from pipeline.trace_types import Box, Orientation, Point

MOSFET_CLASSES = frozenset({"NMOS", "PMOS"})
GATE_CLASSES = frozenset({"AND", "OR", "NOT", "NAND", "NOR", "XOR", "XNOR"})
# Single-wire symbols and the terminal their one drawn lead is (VDD draws only its positive pin).
SINGLE_PIN: dict[str, str] = {"VDD": "pos", "GND": "gnd", "INPUT_PORT": "out", "OUTPUT_PORT": "a", "CLOCK": "out"}
# Placeholder terminals for a MOSFET channel pair whose drain/source order is not known yet.
DS_UNRESOLVED = ("ds0", "ds1")

# Canonical pin offsets from the symbol centre (y down), in the generator's canonical orientation
# (backend/data_gen/synth_v2/symbols.py): MOSFET gate left and channel vertical, gates facing right,
# VDD lead down, GND lead up, input port driving right, output port fed from the left.
CANONICAL_PINS: dict[str, dict[str, Point]] = {
    "NMOS": {"d": (1.0, -2.0), "g": (-1.0, 0.0), "s": (1.0, 2.0), "b": (2.0, 0.0)},
    "PMOS": {"s": (1.0, -2.0), "g": (-1.0, 0.0), "d": (1.0, 2.0), "b": (2.0, 0.0)},
    "AND": {"a": (-2.5, -1.0), "b": (-2.5, 1.0), "out": (2.5, 0.0)},
    "NOT": {"a": (-2.0, 0.0), "out": (2.0, 0.0)},
    "VDD": {"pos": (0.0, 1.0)},
    "GND": {"gnd": (0.0, -1.0)},
    "INPUT_PORT": {"out": (1.0, 0.0)},
    "OUTPUT_PORT": {"a": (-1.0, 0.0)},
}
for _gate in ("OR", "NAND", "NOR", "XOR", "XNOR"):
    CANONICAL_PINS[_gate] = CANONICAL_PINS["AND"]


@dataclass
class Contact:
    """A wire end stopping at a symbol's erased box."""

    symbol: int
    point: Point
    edge: int
    direction: Point  # unit vector from the contact along the wire, away from the symbol
    length: int = 0  # skeleton pixels of the wire run the contact belongs to


def orient_vector(v: Point, orientation: Orientation) -> Point:
    """
    Apply an orientation to a vector: mirror x first, then rotate clockwise on screen (y down).

    Args:
        v: Vector (x, y).
        orientation: Orientation to apply.
    Returns:
        Transformed vector.
    """
    x, y = (-v[0], v[1]) if orientation.mirror else v
    for _ in range((orientation.rotation // 90) % 4):
        x, y = -y, x
    return (x, y)


ALL_ORIENTATIONS: tuple[Orientation, ...] = tuple(Orientation(r, m) for m in (False, True) for r in (0, 90, 180, 270))


def _unit(v: Point) -> Point:
    """
    Normalise a vector.

    Args:
        v: Vector.
    Returns:
        Unit vector, or (0, 0) for a zero vector.
    """
    n = float(np.hypot(v[0], v[1]))
    return (v[0] / n, v[1] / n) if n > 1e-9 else (0.0, 0.0)


def estimate_orientation(class_name: str, box: Box, pins: dict[str, Point]) -> Orientation | None:
    """
    Classical orientation head: the orientation whose canonical pin directions best match the observed pins.

    Args:
        class_name: Canonical class name.
        box: Symbol box (x1, y1, x2, y2).
        pins: Terminal -> resolved image point (only wired/known terminals).
    Returns:
        The best Orientation, or None when the class has no template or no usable pins. Single-pin symbols
        are mirror-symmetric, so their mirror flag is reported as False.
    """
    template = CANONICAL_PINS.get(class_name)
    if template is None:
        return None
    usable = {t: p for t, p in pins.items() if t in template}
    if not usable:
        return None
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    observed = {t: _unit((p[0] - cx, p[1] - cy)) for t, p in usable.items()}
    candidates = ALL_ORIENTATIONS if len(usable) > 1 else ALL_ORIENTATIONS[:4]
    best: tuple[float, Orientation] | None = None
    for o in candidates:
        score = 0.0
        for t, v in observed.items():
            c = _unit(orient_vector(template[t], o))
            score += c[0] * v[0] + c[1] * v[1]
        if best is None or score > best[0] + 1e-9:
            best = (score, o)
    return best[1] if best else None


def _gate_distance(box: Box, margin: float, stroke: float) -> float:
    """
    Largest allowed distance between a keypoint and the contact it is matched to.

    Args:
        box: Symbol box.
        margin: Erase margin around symbol boxes.
        stroke: Stroke width.
    Returns:
        Distance gate in pixels.
    """
    short_side = min(box[2] - box[0], box[3] - box[1])
    return margin + 3.0 * stroke + 0.3 * short_side


def assign_by_keypoints(keypoints: dict[str, Point], contacts: list[Contact], box: Box, margin: float, stroke: float) -> dict[str, Contact]:
    """
    Match contacts to keypoint terminals with a gated optimal assignment.

    Args:
        keypoints: Terminal -> keypoint (image pixels).
        contacts: Contacts of this symbol.
        box: Symbol box.
        margin: Erase margin.
        stroke: Stroke width.
    Returns:
        Terminal -> matched Contact (terminals without a contact within the gate are left out).
    """
    terms = list(keypoints)
    if not terms or not contacts:
        return {}
    cost = np.array([[float(np.hypot(keypoints[t][0] - c.point[0], keypoints[t][1] - c.point[1])) for c in contacts] for t in terms])
    gate = _gate_distance(box, margin, stroke)
    big = 1e6
    rows, cols = linear_sum_assignment(np.where(cost <= gate, cost, big))
    return {terms[r]: contacts[c] for r, c in zip(rows, cols) if cost[r, c] <= gate}


def _side(contact: Contact, box: Box) -> str:
    """
    Box side a contact's wire leaves from: the dominant axis of its direction, else the nearest box edge.

    Args:
        contact: Contact (a wire entering at a box corner is still classified by where it heads).
        box: Box (x1, y1, x2, y2).
    Returns:
        "left", "right", "top" or "bottom".
    """
    dx, dy = contact.direction
    if abs(dx) > 1.5 * abs(dy):
        return "left" if dx < 0 else "right"
    if abs(dy) > 1.5 * abs(dx):
        return "top" if dy < 0 else "bottom"
    x, y = contact.point
    gaps = {"left": abs(x - box[0]), "right": abs(x - box[2]), "top": abs(y - box[1]), "bottom": abs(y - box[3])}
    return min(gaps, key=gaps.get)


_OPPOSITE = {"left": "right", "right": "left", "top": "bottom", "bottom": "top"}
_SIDE_NORMAL: dict[str, Point] = {"left": (-1.0, 0.0), "right": (1.0, 0.0), "top": (0.0, -1.0), "bottom": (0.0, 1.0)}


def _wider_side(ink: np.ndarray, box: Box, side_a: str) -> bool:
    """
    Whether the gate body is wider near side_a than near its opposite side.

    A gate body is widest at its input side (flat back, triangle base) and narrows toward the output
    (curved front, triangle tip, bubble). The body's cross-axis ink extent is compared over the second and
    third quarters of the axis between the two sides (the outer quarters hold mostly the leads).

    Args:
        ink: Bool ink mask of the whole image (before symbol erasure).
        box: Gate box.
        side_a: Side to compare against its opposite.
    Returns:
        True when the body is at least as wide near side_a.
    """
    h, w = ink.shape
    x1, y1 = max(0, int(box[0])), max(0, int(box[1]))
    x2, y2 = min(w, int(np.ceil(box[2]))), min(h, int(np.ceil(box[3])))
    crop = ink[y1:y2, x1:x2]
    if crop.size == 0:
        return True
    if side_a in ("top", "bottom"):
        crop = crop.T
    if side_a in ("right", "bottom"):
        crop = crop[:, ::-1]
    n = crop.shape[1]

    def extent(lo: float, hi: float) -> float:
        """Mean cross-axis ink extent over a slice of the axis."""
        spans = []
        for col in crop[:, int(lo * n) : max(int(lo * n) + 1, int(hi * n))].T:
            rows = np.flatnonzero(col)
            spans.append(float(rows[-1] - rows[0]) if rows.size else 0.0)
        return float(np.mean(spans)) if spans else 0.0

    return extent(0.25, 0.5) >= extent(0.5, 0.75)


def _assign_gate(class_name: str, contacts: list[Contact], box: Box, ink: np.ndarray) -> dict[str, Contact]:
    """
    Geometry-mode terminals of a logic gate: inputs share a side, the output is on the opposite side.

    Args:
        class_name: Gate class.
        contacts: Contacts of this gate.
        box: Gate box.
        ink: Bool ink mask (for the input-side test when the contact layout is ambiguous).
    Returns:
        Terminal -> Contact.
    """
    sides: dict[str, list[Contact]] = {}
    for c in contacts:
        sides.setdefault(_side(c, box), []).append(c)
    n_inputs = 1 if class_name == "NOT" else 2
    crowded = max(sides, key=lambda s: len(sides[s]))
    if len(sides[crowded]) >= 2 and _OPPOSITE[crowded] in sides:
        in_side = crowded
    else:
        candidates = [s for s in sides if _OPPOSITE[s] in sides] or list(sides)
        s0 = candidates[0]
        in_side = s0 if _wider_side(ink, box, s0) else _OPPOSITE[s0]
    out_side = _OPPOSITE[in_side]
    result: dict[str, Contact] = {}
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    if out_side in sides:
        result["out"] = min(sides[out_side], key=lambda c: abs(c.point[1] - cy) if out_side in ("left", "right") else abs(c.point[0] - cx))
    inputs = sides.get(in_side, [])
    if n_inputs == 1:
        if inputs:
            result["a"] = min(inputs, key=lambda c: abs(c.point[1] - cy) if in_side in ("left", "right") else abs(c.point[0] - cx))
        return result
    # Input "a" sits counter-clockwise of the output direction (above it for a right-facing gate).
    dx, dy = _SIDE_NORMAL[out_side]
    left_hand = (dy, -dx)
    ranked = sorted(inputs, key=lambda c: -((c.point[0] - cx) * left_hand[0] + (c.point[1] - cy) * left_hand[1]))
    for term, c in zip(("a", "b"), (ranked[0], ranked[-1]) if len(ranked) >= 2 else ranked[:1]):
        result[term] = c
    return result


def _assign_mosfet(contacts: list[Contact]) -> dict[str, Contact]:
    """
    Geometry-mode terminals of a MOSFET: drain/source are the farthest-apart contacts, the gate is
    the remaining contact farthest from the drain-source line, the body (if any) the one after it.

    Args:
        contacts: Contacts of this transistor.
    Returns:
        Terminal -> Contact, with the channel pair under the placeholders DS_UNRESOLVED.
    """
    if len(contacts) < 2:
        return {"g": contacts[0]} if contacts else {}
    pts = [np.asarray(c.point) for c in contacts]
    i, j = max(combinations(range(len(contacts)), 2), key=lambda ij: float(np.hypot(*(pts[ij[0]] - pts[ij[1]]))))
    if len(contacts) == 2:
        # Both wires on opposite ends: a channel pair with the gate unwired.
        return {DS_UNRESOLVED[0]: contacts[i], DS_UNRESOLVED[1]: contacts[j]}
    a, b = pts[i], pts[j]
    axis = b - a
    norm = float(np.hypot(*axis)) or 1.0

    def line_distance(k: int) -> float:
        """Distance of contact k from the drain-source line."""
        d = pts[k] - a
        return abs(float(axis[0] * d[1] - axis[1] * d[0])) / norm

    rest = sorted((k for k in range(len(contacts)) if k not in (i, j)), key=line_distance, reverse=True)
    result = {DS_UNRESOLVED[0]: contacts[i], DS_UNRESOLVED[1]: contacts[j], "g": contacts[rest[0]]}
    if len(rest) > 1:
        result["b"] = contacts[rest[1]]
    return result


def _assign_generic(terminals: tuple[str, ...], contacts: list[Contact], box: Box) -> dict[str, Contact]:
    """
    Fallback for classes without a layout rule: terminals in declared order around the box (clockwise from the left).

    Args:
        terminals: Terminal names of the class.
        contacts: Contacts of this symbol.
        box: Symbol box.
    Returns:
        Terminal -> Contact.
    """
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    ordered = sorted(contacts, key=lambda c: (np.arctan2(c.point[1] - cy, c.point[0] - cx) + np.pi) % (2 * np.pi))
    return dict(zip(terminals, ordered))


def assign_by_geometry(class_name: str, terminals: tuple[str, ...], contacts: list[Contact], box: Box, ink: np.ndarray) -> dict[str, Contact]:
    """
    Classical pin assignment when the detector gives no keypoints.

    Args:
        class_name: Canonical class name.
        terminals: Terminal names of the class.
        contacts: Contacts of this symbol.
        box: Symbol box.
        ink: Bool ink mask (before symbol erasure).
    Returns:
        Terminal -> Contact (MOSFET channel pairs use the DS_UNRESOLVED placeholders).
    """
    if not contacts:
        return {}
    if class_name in MOSFET_CLASSES:
        return _assign_mosfet(contacts)
    if class_name in GATE_CLASSES:
        return _assign_gate(class_name, contacts, box, ink)
    if class_name in SINGLE_PIN:
        return {SINGLE_PIN[class_name]: max(contacts, key=lambda c: c.length)}
    return _assign_generic(terminals, contacts, box)


def _hops(sources: set[str], adjacency: dict[str, set[str]]) -> dict[str, int]:
    """
    Breadth-first channel-hop distance from a set of nets.

    Args:
        sources: Start nets (distance 0).
        adjacency: Net -> nets reachable through one transistor channel.
    Returns:
        Net -> hop count for every reachable net.
    """
    dist: dict[str, int] = {n: 0 for n in sources}
    queue = deque(dist)
    while queue:
        n = queue.popleft()
        for m in adjacency.get(n, ()):
            if m not in dist:
                dist[m] = dist[n] + 1
                queue.append(m)
    return dist


def _closer(n0: str | None, n1: str | None, dist: dict[str, int]) -> int | None:
    """
    Which of two nets is strictly closer under a distance map.

    Args:
        n0: First net.
        n1: Second net.
        dist: Net -> distance.
    Returns:
        0 or 1 for the strictly closer net, None on a tie or when neither is reachable.
    """
    d0 = dist.get(n0) if n0 else None
    d1 = dist.get(n1) if n1 else None
    if d0 is not None and (d1 is None or d0 < d1):
        return 0
    if d1 is not None and (d0 is None or d1 < d0):
        return 1
    return None


def resolve_drain_source(
    mosfets: list[tuple[str, str, str | None, str | None, Point | None, Point | None]],
    supply_nets: dict[str, set[str]],
    input_nets: set[str] | None = None,
) -> dict[str, tuple[str, str]]:
    """
    Electrical drain/source rule: an NMOS source is the channel end closer (through NMOS channels) to a
    ground net, a PMOS source the end closer (through PMOS channels) to a VDD net. A pass transistor that
    reaches no supply (transmission gates) takes its source at the end closer to an input port, through any
    channel. Remaining ties fall back to the upright-drawing convention (NMOS source below, PMOS above).

    Args:
        mosfets: (component id, class, net of ds0, net of ds1, point of ds0, point of ds1) per unresolved MOSFET.
        supply_nets: {"NMOS": ground nets, "PMOS": VDD nets}.
        input_nets: Nets driven by input ports.
    Returns:
        Component id -> (terminal for ds0, terminal for ds1), each "d" or "s".
    """
    result: dict[str, tuple[str, str]] = {}
    every: dict[str, set[str]] = {}
    for _, _, n0, n1, _, _ in mosfets:
        if n0 and n1 and n0 != n1:
            every.setdefault(n0, set()).add(n1)
            every.setdefault(n1, set()).add(n0)
    from_inputs = _hops(input_nets or set(), every)
    for polarity in ("NMOS", "PMOS"):
        adjacency: dict[str, set[str]] = {}
        for _, cls, n0, n1, _, _ in mosfets:
            if cls == polarity and n0 and n1 and n0 != n1:
                adjacency.setdefault(n0, set()).add(n1)
                adjacency.setdefault(n1, set()).add(n0)
        dist = _hops(supply_nets.get(polarity, set()), adjacency)
        for cid, cls, n0, n1, p0, p1 in mosfets:
            if cls != polarity:
                continue
            closer = _closer(n0, n1, dist)
            if closer is None and not (dist.get(n0 or "") is not None or dist.get(n1 or "") is not None):
                closer = _closer(n0, n1, from_inputs)
            if closer == 0:
                result[cid] = ("s", "d")
            elif closer == 1:
                result[cid] = ("d", "s")
            else:
                lower_first = p0 is not None and p1 is not None and p0[1] > p1[1]
                # NMOS source drawn below its drain, PMOS source above.
                first_is_source = lower_first if polarity == "NMOS" else not lower_first
                result[cid] = ("s", "d") if first_is_source else ("d", "s")
    return result
