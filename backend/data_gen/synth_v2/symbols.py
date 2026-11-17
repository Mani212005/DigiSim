"""
Module: symbols.py
Purpose: Vector geometry of every tier-A schematic symbol drawn by the v2 generator, in
         grid units with pins on integer grid points. Each class has several textbook style
         variants (3- vs 4-terminal MOSFETs, bubble vs arrow PMOS, ANSI vs IEC gates, supply
         and port shapes). Also implements the 8 orientations (4 rotations x mirror) so pins,
         pin directions and strokes transform exactly; the renderer turns this into pixels.

Coordinates are y-down. Orientation = mirror (x -> -x) applied first, then `rotation`
degrees clockwise on screen.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np

GridPoint = tuple[int, int]


@dataclass(frozen=True)
class SymbolGeometry:
    """Strokes, fills, in-symbol text and pins of one symbol in local grid units."""

    strokes: tuple[np.ndarray, ...]
    fills: tuple[np.ndarray, ...] = ()
    pins: dict[str, GridPoint] = field(default_factory=dict)
    pin_dirs: dict[str, GridPoint] = field(default_factory=dict)
    texts: tuple[tuple[str, tuple[float, float], float], ...] = ()


# Variants per class: the renderer picks one per image (consistent style within a drawing).
VARIANTS: dict[str, tuple[str, ...]] = {
    "NMOS": ("plain3", "arrow3", "dashed3", "body4"),
    "PMOS": ("bubble3", "arrow3", "bubble4", "body4"),
    "VDD": ("bar", "arrow", "circle"),
    "GND": ("bars", "triangle", "filled"),
    "INPUT_PORT": ("tag", "arrow"),
    "OUTPUT_PORT": ("tag", "arrow"),
    "GATE": ("ansi", "iec"),
}


def _line(*pts: tuple[float, float]) -> np.ndarray:
    """
    Polyline from points.

    Args:
        pts: Vertices in local units.
    Returns:
        Nx2 float array.
    """
    return np.array(pts, dtype=np.float64)


def _closed(*pts: tuple[float, float]) -> np.ndarray:
    """
    Closed polyline (first vertex repeated at the end).

    Args:
        pts: Vertices in local units.
    Returns:
        (N+1)x2 float array.
    """
    return np.array(list(pts) + [pts[0]], dtype=np.float64)


def _arc(cx: float, cy: float, rx: float, ry: float, a0: float, a1: float, n: int = 24) -> np.ndarray:
    """
    Elliptical arc, angles in degrees (y-down, so +90 is straight down).

    Args:
        cx: Centre x.
        cy: Centre y.
        rx: Horizontal radius.
        ry: Vertical radius.
        a0: Start angle.
        a1: End angle.
        n: Number of samples.
    Returns:
        Nx2 float array.
    """
    ang = np.deg2rad(np.linspace(a0, a1, n))
    return np.stack([cx + rx * np.cos(ang), cy + ry * np.sin(ang)], axis=1)


def _circle(cx: float, cy: float, r: float, n: int = 20) -> np.ndarray:
    """
    Closed circle polyline.

    Args:
        cx: Centre x.
        cy: Centre y.
        r: Radius.
        n: Number of segments.
    Returns:
        (N+1)x2 float array.
    """
    return _arc(cx, cy, r, r, 0, 360, n + 1)


def _bezier(p0: tuple[float, float], p1: tuple[float, float], p2: tuple[float, float], n: int = 16) -> np.ndarray:
    """
    Quadratic Bezier curve.

    Args:
        p0: Start point.
        p1: Control point.
        p2: End point.
        n: Number of samples.
    Returns:
        Nx2 float array.
    """
    t = np.linspace(0.0, 1.0, n)[:, None]
    a, b, c = (np.array(p, dtype=np.float64) for p in (p0, p1, p2))
    return (1 - t) ** 2 * a + 2 * (1 - t) * t * b + t**2 * c


def _mosfet(cls: str, variant: str) -> SymbolGeometry:
    """
    MOSFET symbol, canonical orientation: gate pin left, channel vertical.

    NMOS: drain top (0,-2), source bottom (0,2). PMOS: source top, drain bottom. The gate pin
    is (-2,0) and the optional body pin (1,0).

    Args:
        cls: "NMOS" or "PMOS".
        variant: One of VARIANTS[cls].
    Returns:
        Symbol geometry.
    """
    is_p = cls == "PMOS"
    bubble = is_p and variant in ("bubble3", "bubble4")
    strokes: list[np.ndarray] = []
    fills: list[np.ndarray] = []
    gate_end = -1.11 if bubble else -0.65
    strokes.append(_line((-2, 0), (gate_end, 0)))
    if bubble:
        strokes.append(_circle(-0.88, 0, 0.23))
    strokes.append(_line((-0.65, -0.75), (-0.65, 0.75)))
    if variant == "dashed3":
        for y0, y1 in ((-1.0, -0.45), (-0.25, 0.25), (0.45, 1.0)):
            strokes.append(_line((-0.35, y0), (-0.35, y1)))
    else:
        strokes.append(_line((-0.35, -1.0), (-0.35, 1.0)))
    top, bottom = ("s", "d") if is_p else ("d", "s")
    strokes.append(_line((-0.35, -0.7), (0, -0.7), (0, -2)))
    strokes.append(_line((-0.35, 0.7), (0, 0.7), (0, 2)))
    pins = {"g": (-2, 0), top: (0, -2), bottom: (0, 2)}
    dirs = {"g": (-1, 0), top: (0, -1), bottom: (0, 1)}
    if variant == "arrow3":
        # Arrow on the source lead: out of the channel for NMOS, into it for PMOS.
        y = -0.7 if is_p else 0.7
        if is_p:
            fills.append(_closed((-0.33, y), (-0.05, y - 0.16), (-0.05, y + 0.16)))
        else:
            fills.append(_closed((-0.02, y), (-0.3, y - 0.16), (-0.3, y + 0.16)))
    if variant in ("body4", "bubble4"):
        strokes.append(_line((-0.35, 0), (1, 0)))
        if variant == "body4":
            if is_p:
                fills.append(_closed((0.35, 0), (0.07, -0.16), (0.07, 0.16)))
            else:
                fills.append(_closed((-0.3, 0), (-0.02, -0.16), (-0.02, 0.16)))
        pins["b"] = (1, 0)
        dirs["b"] = (1, 0)
    return SymbolGeometry(tuple(strokes), tuple(fills), pins, dirs)


def _supply(cls: str, variant: str) -> SymbolGeometry:
    """
    VDD (pin at bottom, symbol above) or GND (pin at top, symbol below).

    Args:
        cls: "VDD" or "GND".
        variant: One of VARIANTS[cls].
    Returns:
        Symbol geometry.
    """
    strokes: list[np.ndarray] = []
    fills: list[np.ndarray] = []
    if cls == "VDD":
        if variant == "bar":
            strokes += [_line((0, 0), (0, -1)), _line((-0.7, -1), (0.7, -1))]
        elif variant == "arrow":
            strokes += [_line((0, 0), (0, -1.25)), _line((-0.45, -0.8), (0, -1.25), (0.45, -0.8))]
        else:
            strokes += [_line((0, 0), (0, -0.85)), _circle(0, -1.12, 0.27)]
        return SymbolGeometry(tuple(strokes), (), {"pos": (0, 0)}, {"pos": (0, 1)})
    strokes.append(_line((0, 0), (0, 1)))
    if variant == "bars":
        strokes += [_line((-0.7, 1), (0.7, 1)), _line((-0.45, 1.25), (0.45, 1.25)), _line((-0.2, 1.5), (0.2, 1.5))]
    elif variant == "triangle":
        strokes.append(_closed((-0.6, 1), (0.6, 1), (0, 1.6)))
    else:
        fills.append(_closed((-0.6, 1), (0.6, 1), (0, 1.6)))
        strokes.append(_closed((-0.6, 1), (0.6, 1), (0, 1.6)))
    return SymbolGeometry(tuple(strokes), tuple(fills), {"gnd": (0, 0)}, {"gnd": (0, -1)})


def _port(cls: str, variant: str) -> SymbolGeometry:
    """
    Input port (drives a net to its right) or output port (net arrives from its left).

    Args:
        cls: "INPUT_PORT" or "OUTPUT_PORT".
        variant: One of VARIANTS[cls].
    Returns:
        Symbol geometry.
    """
    if cls == "INPUT_PORT":
        if variant == "tag":
            strokes = (_closed((-2.4, -0.5), (-1.0, -0.5), (-0.5, 0), (-1.0, 0.5), (-2.4, 0.5)), _line((-0.5, 0), (0, 0)))
            return SymbolGeometry(strokes, (), {"out": (0, 0)}, {"out": (1, 0)})
        strokes = (_line((-2.2, 0), (0, 0)),)
        fills = (_closed((-1.25, -0.38), (-0.35, 0), (-1.25, 0.38)),)
        return SymbolGeometry(strokes, fills, {"out": (0, 0)}, {"out": (1, 0)})
    if variant == "tag":
        strokes = (_line((0, 0), (0.5, 0)), _closed((0.5, -0.5), (1.9, -0.5), (2.4, 0), (1.9, 0.5), (0.5, 0.5)))
        return SymbolGeometry(strokes, (), {"a": (0, 0)}, {"a": (-1, 0)})
    strokes = (_line((0, 0), (2.2, 0)),)
    fills = (_closed((1.4, -0.38), (2.3, 0), (1.4, 0.38)),)
    return SymbolGeometry(strokes, fills, {"a": (0, 0)}, {"a": (-1, 0)})


_IEC_TEXT = {"AND": "&", "NAND": "&", "OR": ">=1", "NOR": ">=1", "XOR": "=1", "XNOR": "=1", "NOT": "1"}


def _gate(cls: str, variant: str) -> SymbolGeometry:
    """
    Logic gate facing right: inputs a (-1,-1) and b (-1,1) (NOT: a at (-1,0)), output at the right.

    Args:
        cls: Gate class (AND ... XNOR).
        variant: "ansi" (distinctive shapes) or "iec" (rectangle with qualifier text).
    Returns:
        Symbol geometry.
    """
    inverted = cls in ("NAND", "NOR", "XNOR", "NOT")
    strokes: list[np.ndarray] = []
    texts: list[tuple[str, tuple[float, float], float]] = []
    if cls == "NOT":
        pins = {"a": (-1, 0), "out": (3, 0)}
        dirs = {"a": (-1, 0), "out": (1, 0)}
        if variant == "iec":
            strokes += [_closed((0, -1), (2, -1), (2, 1), (0, 1)), _line((-1, 0), (0, 0))]
            texts.append(("1", (1.0, 0.0), 0.8))
        else:
            strokes += [_closed((0, -1), (0, 1), (2, 0)), _line((-1, 0), (0, 0))]
        strokes += [_circle(2.22, 0, 0.22), _line((2.44, 0), (3, 0))]
        return SymbolGeometry(tuple(strokes), (), pins, dirs, tuple(texts))
    pins = {"a": (-1, -1), "b": (-1, 1), "out": (4, 0)}
    dirs = {"a": (-1, 0), "b": (-1, 0), "out": (1, 0)}
    if variant == "iec":
        strokes.append(_closed((0, -1.5), (2.6, -1.5), (2.6, 1.5), (0, 1.5)))
        strokes += [_line((-1, -1), (0, -1)), _line((-1, 1), (0, 1))]
        texts.append((_IEC_TEXT[cls], (1.3, 0.0), 0.8))
        front = 2.6
    else:
        shift = 0.4 if cls in ("XOR", "XNOR") else 0.0
        length = 2.6 if inverted else 3.0
        if cls in ("AND", "NAND"):
            straight = length - 1.5
            strokes.append(_line((straight, -1.5), (0, -1.5), (0, 1.5), (straight, 1.5)))
            strokes.append(_arc(straight, 0, 1.5, 1.5, -90, 90))
            back_x = 0.0
        else:
            strokes.append(_bezier((shift, -1.5), (shift + 0.6, 0), (shift, 1.5)))
            strokes.append(_bezier((shift, -1.5), (shift + 0.63 * length, -1.5), (shift + length, 0)))
            strokes.append(_bezier((shift, 1.5), (shift + 0.63 * length, 1.5), (shift + length, 0)))
            if shift:
                strokes.append(_bezier((0, -1.5), (0.6, 0), (0, 1.5)))
            back_x = 0.1667
        strokes += [_line((-1, -1), (back_x, -1)), _line((-1, 1), (back_x, 1))]
        front = shift + length
    if inverted:
        strokes.append(_circle(front + 0.22, 0, 0.22))
        front += 0.44
    strokes.append(_line((front, 0), (4, 0)))
    return SymbolGeometry(tuple(strokes), (), pins, dirs, tuple(texts))


@lru_cache(maxsize=None)
def symbol_geometry(cls: str, variant: str) -> SymbolGeometry:
    """
    Local geometry for a class and style variant.

    Args:
        cls: Tier-A class name except JUNCTION (drawn by the renderer as a dot).
        variant: Variant name (gates use VARIANTS["GATE"]).
    Returns:
        Symbol geometry in canonical orientation.
    Raises:
        ValueError: For unknown classes.
    """
    if cls in ("NMOS", "PMOS"):
        return _mosfet(cls, variant)
    if cls in ("VDD", "GND"):
        return _supply(cls, variant)
    if cls in ("INPUT_PORT", "OUTPUT_PORT"):
        return _port(cls, variant)
    if cls in ("AND", "OR", "NOT", "NAND", "NOR", "XOR", "XNOR"):
        return _gate(cls, variant)
    raise ValueError(f"no symbol geometry for class {cls!r}")


def orient_points(pts: np.ndarray, rotation: int, mirror: bool) -> np.ndarray:
    """
    Apply an orientation to local points (mirror x first, then rotate clockwise).

    Args:
        pts: Nx2 array.
        rotation: 0, 90, 180 or 270 degrees clockwise (y-down screen).
        mirror: Mirror horizontally before rotating.
    Returns:
        Nx2 transformed array.
    """
    out = np.array(pts, dtype=np.float64).reshape(-1, 2).copy()
    if mirror:
        out[:, 0] = -out[:, 0]
    for _ in range((rotation // 90) % 4):
        out = np.stack([-out[:, 1], out[:, 0]], axis=1)
    return out


def orient_grid(p: GridPoint, rotation: int, mirror: bool) -> GridPoint:
    """
    Orient one integer grid point or direction.

    Args:
        p: (x, y) integers.
        rotation: Degrees clockwise.
        mirror: Mirror before rotating.
    Returns:
        Transformed integer point.
    """
    x, y = p
    if mirror:
        x = -x
    for _ in range((rotation // 90) % 4):
        x, y = -y, x
    return (x, y)


def compose_orientation(inner: tuple[int, bool], outer: tuple[int, bool]) -> tuple[int, bool]:
    """
    Orientation equal to applying `inner` then `outer`.

    Args:
        inner: (rotation, mirror) applied first.
        outer: (rotation, mirror) applied second.
    Returns:
        Combined (rotation, mirror).
    """
    r1, m1 = inner
    r2, m2 = outer
    if m2:
        return ((r2 - r1) % 360, not m1)
    return ((r1 + r2) % 360, m1)


def orientation_for(cls: str, variant: str, pin: str, direction: GridPoint, mirror: bool = False) -> int:
    """
    Rotation that makes a given pin face a given direction.

    Args:
        cls: Class name.
        variant: Variant name.
        pin: Pin name.
        direction: Desired outward unit direction.
        mirror: Whether the symbol is mirrored.
    Returns:
        Rotation in degrees.
    Raises:
        ValueError: If no rotation achieves it.
    """
    geom = symbol_geometry(cls, variant)
    for rot in (0, 90, 180, 270):
        if orient_grid(geom.pin_dirs[pin], rot, mirror) == direction:
            return rot
    raise ValueError(f"cannot face {cls}.{pin} towards {direction}")
