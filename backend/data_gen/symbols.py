"""
Module: symbols.py
Purpose: Hand-drawn-style rendering of logic-gate schematic symbols with OpenCV.
         Produces jittered pen strokes that mimic the hand-drawn circuit photos in
         the training domain, and returns tight bounding boxes + wire ports so the
         screenshot pipeline can auto-generate YOLO labels and route wires.
"""

from dataclasses import dataclass, field

import cv2
import numpy as np

# Canonical class list for the whole ML pipeline (ids are the YOLO class ids).
CLASS_NAMES: list[str] = [
    "AND",
    "OR",
    "NOT",
    "NAND",
    "NOR",
    "XOR",
    "XNOR",
    "SWITCH",
    "INPUT",
    "OUTPUT",
    "LED",
    "JUNCTION",
]

CLASS_TO_ID: dict[str, int] = {name: i for i, name in enumerate(CLASS_NAMES)}


@dataclass
class DrawnSymbol:
    """Result of rendering one symbol: label box and wire attachment points."""

    class_name: str
    bbox: tuple[float, float, float, float]  # x1, y1, x2, y2 in pixels
    in_ports: list[tuple[float, float]] = field(default_factory=list)
    out_port: tuple[float, float] | None = None


def _jitter(pts: np.ndarray, rng: np.random.Generator, sigma: float) -> np.ndarray:
    """
    Add hand-wobble noise to a polyline.

    Args:
        pts: Nx2 float array of points.
        rng: Random generator.
        sigma: Std-dev of the per-point Gaussian displacement in pixels.
    Returns:
        Nx2 float array with noise added.
    """
    return pts + rng.normal(0.0, sigma, pts.shape)


def _densify(pts: np.ndarray, step: float = 9.0) -> np.ndarray:
    """
    Resample a polyline so consecutive points are at most `step` pixels apart.

    Args:
        pts: Nx2 float array of polyline vertices.
        step: Maximum spacing between resampled points.
    Returns:
        Mx2 float array of resampled points.
    """
    out: list[np.ndarray] = []
    for a, b in zip(pts[:-1], pts[1:]):
        seg_len = float(np.linalg.norm(b - a))
        n = max(2, int(seg_len / step) + 1)
        ts = np.linspace(0.0, 1.0, n, endpoint=False)
        out.append(a[None, :] + ts[:, None] * (b - a)[None, :])
    out.append(pts[-1:])
    return np.concatenate(out, axis=0)


def _bezier(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    n: int = 16,
) -> np.ndarray:
    """
    Sample a quadratic Bezier curve.

    Args:
        p0: Start point.
        p1: Control point.
        p2: End point.
        n: Number of samples.
    Returns:
        Nx2 float array of curve points.
    """
    t = np.linspace(0.0, 1.0, n)[:, None]
    a, b, c = (np.array(p, dtype=np.float64) for p in (p0, p1, p2))
    return (1 - t) ** 2 * a + 2 * (1 - t) * t * b + t**2 * c


def _arc(
    center: tuple[float, float],
    rx: float,
    ry: float,
    deg_start: float,
    deg_end: float,
    n: int = 18,
) -> np.ndarray:
    """
    Sample an elliptical arc.

    Args:
        center: Ellipse center.
        rx: Horizontal radius.
        ry: Vertical radius.
        deg_start: Arc start angle in degrees.
        deg_end: Arc end angle in degrees.
        n: Number of samples.
    Returns:
        Nx2 float array of arc points.
    """
    ang = np.deg2rad(np.linspace(deg_start, deg_end, n))
    return np.stack(
        [center[0] + rx * np.cos(ang), center[1] + ry * np.sin(ang)], axis=1
    )


def hand_stroke(
    img: np.ndarray,
    pts: np.ndarray,
    color: tuple[int, int, int],
    thickness: int,
    rng: np.random.Generator,
    sigma: float = 1.1,
) -> np.ndarray:
    """
    Draw one hand-drawn-looking pen stroke onto the image.

    Args:
        img: BGR canvas modified in place.
        pts: Nx2 float array of stroke vertices (pre-densification).
        color: BGR pen colour.
        thickness: Stroke thickness in pixels.
        rng: Random generator.
        sigma: Wobble magnitude in pixels.
    Returns:
        The jittered points actually drawn (used for bounding-box computation).
    """
    dense = _densify(pts)
    wobbly = _jitter(dense, rng, sigma)
    cv2.polylines(img, [wobbly.astype(np.int32)], False, color, thickness, cv2.LINE_AA)
    return wobbly


def _circle_pts(center: tuple[float, float], r: float, n: int = 20) -> np.ndarray:
    """
    Sample a full circle as a closed polyline.

    Args:
        center: Circle center.
        r: Radius.
        n: Number of samples.
    Returns:
        (N+1)x2 float array with the first point repeated at the end.
    """
    pts = _arc(center, r, r, 0, 360, n)
    return np.vstack([pts, pts[:1]])


def _symbol_strokes(
    class_name: str, rng: np.random.Generator
) -> tuple[list[np.ndarray], list[tuple[float, float]], tuple[float, float] | None]:
    """
    Build the stroke set for a symbol in local coordinates (roughly 100x70 box).

    Args:
        class_name: One of CLASS_NAMES.
        rng: Random generator (used for small per-instance shape variation).
    Returns:
        Tuple of (strokes, in_ports, out_port) in local coordinates.
    Raises:
        ValueError: If class_name is not a known symbol.
    """
    h = 70.0
    strokes: list[np.ndarray] = []
    in_ports: list[tuple[float, float]] = []
    out_port: tuple[float, float] | None = None

    def and_body(x0: float) -> None:
        """Append AND-gate body strokes starting at local x offset x0."""
        strokes.append(
            np.array([[x0 + 55, 0], [x0, 0], [x0, h], [x0 + 55, h]], dtype=np.float64)
        )
        strokes.append(_arc((x0 + 55, h / 2), 45, h / 2, -90, 90))

    def or_body(x0: float) -> None:
        """Append OR-gate body strokes starting at local x offset x0."""
        strokes.append(np.vstack([_bezier((x0, 0), (x0 + 20, h / 2), (x0, h))]))
        strokes.append(_bezier((x0, 0), (x0 + 65, 4), (x0 + 100, h / 2)))
        strokes.append(_bezier((x0, h), (x0 + 65, h - 4), (x0 + 100, h / 2)))

    def bubble(cx: float) -> None:
        """Append the inversion bubble circle centred at (cx, h/2)."""
        strokes.append(_circle_pts((cx, h / 2), 7))

    if class_name == "AND":
        and_body(0)
        in_ports = [(0, h * 0.28), (0, h * 0.72)]
        out_port = (100, h / 2)
    elif class_name == "NAND":
        and_body(0)
        bubble(107)
        in_ports = [(0, h * 0.28), (0, h * 0.72)]
        out_port = (114, h / 2)
    elif class_name == "OR":
        or_body(0)
        in_ports = [(6, h * 0.28), (6, h * 0.72)]
        out_port = (100, h / 2)
    elif class_name == "NOR":
        or_body(0)
        bubble(107)
        in_ports = [(6, h * 0.28), (6, h * 0.72)]
        out_port = (114, h / 2)
    elif class_name in ("XOR", "XNOR"):
        or_body(12)
        strokes.append(_bezier((0, 0), (20, h / 2), (0, h)))
        in_ports = [(3, h * 0.28), (3, h * 0.72)]
        if class_name == "XNOR":
            bubble(119)
            out_port = (126, h / 2)
        else:
            out_port = (112, h / 2)
    elif class_name == "NOT":
        strokes.append(
            np.array([[0, 0], [0, h], [80, h / 2], [0, 0]], dtype=np.float64)
        )
        bubble(87)
        in_ports = [(0, h / 2)]
        out_port = (94, h / 2)
    elif class_name == "SWITCH":
        strokes.append(np.array([[0, h / 2], [10, h / 2]], dtype=np.float64))
        strokes.append(_circle_pts((15, h / 2), 4, 12))
        strokes.append(np.array([[18, h / 2 - 3], [78, 8]], dtype=np.float64))
        strokes.append(_circle_pts((85, h / 2), 4, 12))
        strokes.append(np.array([[90, h / 2], [100, h / 2]], dtype=np.float64))
        in_ports = [(0, h / 2)]
        out_port = (100, h / 2)
    elif class_name == "INPUT":
        strokes.append(
            np.array([[0, 10], [44, 10], [44, 60], [0, 60], [0, 10]], dtype=np.float64)
        )
        strokes.append(np.array([[44, 35], [70, 35]], dtype=np.float64))
        out_port = (70, 35)
    elif class_name == "OUTPUT":
        strokes.append(_circle_pts((36, 35), 24))
        strokes.append(np.array([[0, 35], [12, 35]], dtype=np.float64))
        in_ports = [(0, 35)]
    elif class_name == "LED":
        strokes.append(
            np.array([[10, 10], [10, 60], [52, 35], [10, 10]], dtype=np.float64)
        )
        strokes.append(np.array([[52, 10], [52, 60]], dtype=np.float64))
        strokes.append(np.array([[0, 35], [10, 35]], dtype=np.float64))
        # Two small emission arrows pointing up-right.
        for dx in (0.0, 12.0):
            strokes.append(np.array([[34 + dx, 8], [46 + dx, -6]], dtype=np.float64))
            strokes.append(np.array([[46 + dx, -6], [40 + dx, -5]], dtype=np.float64))
            strokes.append(np.array([[46 + dx, -6], [45 + dx, 0]], dtype=np.float64))
        in_ports = [(0, 35)]
    elif class_name == "JUNCTION":
        # Drawn as a filled dot by draw_symbol; strokes stay empty.
        pass
    else:
        raise ValueError(f"Unknown symbol class: {class_name}")

    return strokes, in_ports, out_port


def draw_symbol(
    img: np.ndarray,
    class_name: str,
    cx: float,
    cy: float,
    scale: float,
    color: tuple[int, int, int],
    thickness: int,
    rng: np.random.Generator,
) -> DrawnSymbol:
    """
    Render one hand-drawn symbol centred at (cx, cy) and return its label info.

    Args:
        img: BGR canvas modified in place.
        class_name: One of CLASS_NAMES.
        cx: Symbol centre x in pixels.
        cy: Symbol centre y in pixels.
        scale: Uniform scale factor applied to the local geometry.
        color: BGR pen colour.
        thickness: Stroke thickness in pixels.
        rng: Random generator.
    Returns:
        DrawnSymbol with pixel-space bbox and wire ports.
    """
    if class_name == "JUNCTION":
        r = max(3.0, 4.5 * scale)
        cv2.circle(img, (int(cx), int(cy)), int(r), color, -1, cv2.LINE_AA)
        pad = r + 6.0
        return DrawnSymbol(
            class_name,
            (cx - pad, cy - pad, cx + pad, cy + pad),
            in_ports=[(cx, cy)],
            out_port=(cx, cy),
        )

    strokes, in_ports, out_port = _symbol_strokes(class_name, rng)

    # Local geometry is centred around (50, 35); rotate slightly and scale.
    angle = np.deg2rad(rng.uniform(-3.0, 3.0))
    rot = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])

    def to_world(pts: np.ndarray) -> np.ndarray:
        """Map local symbol coordinates to canvas pixel coordinates."""
        centred = (pts - np.array([50.0, 35.0])) * scale
        return centred @ rot.T + np.array([cx, cy])

    drawn_pts: list[np.ndarray] = []
    for stroke in strokes:
        world = to_world(stroke)
        drawn = hand_stroke(img, world, color, thickness, rng)
        drawn_pts.append(drawn)

    all_pts = np.concatenate(drawn_pts, axis=0)
    margin = 4.0
    bbox = (
        float(all_pts[:, 0].min() - margin),
        float(all_pts[:, 1].min() - margin),
        float(all_pts[:, 0].max() + margin),
        float(all_pts[:, 1].max() + margin),
    )

    world_in = [tuple(to_world(np.array([[px, py]]))[0]) for px, py in in_ports]
    world_out = tuple(to_world(np.array([list(out_port)]))[0]) if out_port else None
    return DrawnSymbol(class_name, bbox, in_ports=world_in, out_port=world_out)
