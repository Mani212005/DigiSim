"""
Module: render.py
Purpose: Rasterises a routed Layout into a training image in one of four rendering modes
         (cad, textbook, hand-drawn, phone photo) with paper textures, pen styles, fonts and
         photo effects, and returns exact annotations: YOLO boxes, per-symbol pin points and
         orientation, junction dots, wire polylines, crossings and text boxes. Junction dot
         diameters follow the real-image finding (10-17 px at 1000 px image width).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import cv2
import numpy as np

from .layout import Layout
from .schema import CLASS_ID
from .symbols import orient_points, symbol_geometry

MODES: tuple[str, ...] = ("cad", "textbook", "hand", "photo")
TRAIN_FONTS: dict[str, int] = {
    "simplex": cv2.FONT_HERSHEY_SIMPLEX,
    "duplex": cv2.FONT_HERSHEY_DUPLEX,
    "complex": cv2.FONT_HERSHEY_COMPLEX,
    "triplex": cv2.FONT_HERSHEY_TRIPLEX,
    "plain": cv2.FONT_HERSHEY_PLAIN,
    "script_simplex": cv2.FONT_HERSHEY_SCRIPT_SIMPLEX,
}
# Rendering style values reserved for held-out-style test samples (never used in train/valid).
HELD_OUT_FONT = "script_complex"
HELD_OUT_PAPER = "grid"
HELD_OUT_LINE = "sketch"
FONTS: dict[str, int] = {**TRAIN_FONTS, HELD_OUT_FONT: cv2.FONT_HERSHEY_SCRIPT_COMPLEX}
TRAIN_PAPERS: tuple[str, ...] = ("white", "cream", "lined", "noisy")
INKS: dict[str, tuple[int, int, int]] = {
    "black": (20, 20, 20),
    "gray": (70, 70, 70),
    "blue": (150, 60, 25),
    "pencil": (95, 95, 100),
}
DOT_MIN_PER_1000 = 10.0
DOT_MAX_PER_1000 = 17.0
TITLES: tuple[str, ...] = ("Fig. 1", "Fig. 3", "CMOS", "Circuit", "Ex. 2", "Lab 4", "static CMOS", "Logic", "Q3", "Schematic")


@dataclass
class RenderStyle:
    """Pixel-level rendering choices for one image."""

    mode: str
    pitch: float
    thickness: int
    font: str
    paper: str
    ink: str
    line: str  # "clean" | "wobble" | "sketch"
    wobble: float
    dot_per_1000: float
    jpeg_quality: int
    label_ports: bool
    label_supplies: bool
    label_devices: bool
    title: bool


def sample_render_style(rng: np.random.Generator, layout: Layout, held_out: bool) -> RenderStyle:
    """
    Sample the rendering style; held-out samples use the reserved font, paper and line style.

    Args:
        rng: Random generator.
        layout: Routed layout (its grid size bounds the pitch).
        held_out: Whether this is a held-out-style test sample.
    Returns:
        RenderStyle.
    """
    mode = ("textbook", "hand", "photo")[int(rng.integers(0, 3))] if held_out else MODES[int(rng.integers(0, 4))]
    pitch = float(rng.uniform(15.0, 24.0))
    width_px = layout.width * pitch
    if width_px < 700:
        pitch = 700.0 / layout.width
    elif width_px > 1800:
        pitch = 1800.0 / layout.width
    rel = {"cad": (0.07, 0.1), "textbook": (0.09, 0.14), "hand": (0.1, 0.17), "photo": (0.1, 0.17)}[mode]
    thickness = max(1, round(pitch * float(rng.uniform(*rel))))
    hi = min(DOT_MAX_PER_1000, 0.8 * 1000.0 / layout.width)
    dot = float(rng.uniform(DOT_MIN_PER_1000, max(DOT_MIN_PER_1000, hi)))
    if held_out:
        font, paper, line = HELD_OUT_FONT, HELD_OUT_PAPER, (HELD_OUT_LINE if mode != "textbook" else "clean")
    else:
        font = sorted(TRAIN_FONTS)[int(rng.integers(0, len(TRAIN_FONTS)))]
        if mode == "cad":
            paper = "white"
        elif mode == "textbook":
            paper = ("white", "cream")[int(rng.integers(0, 2))]
        else:
            paper = TRAIN_PAPERS[int(rng.integers(0, len(TRAIN_PAPERS)))]
        line = "clean" if mode in ("cad", "textbook") else "wobble"
    if mode in ("cad", "textbook"):
        ink = ("black", "gray")[int(rng.integers(0, 2))]
    else:
        ink = ("black", "blue", "pencil", "gray")[int(rng.integers(0, 4))]
    quality = {"cad": (92, 97), "textbook": (85, 95), "hand": (80, 92), "photo": (55, 85)}[mode]
    return RenderStyle(
        mode=mode,
        pitch=round(pitch, 4),
        thickness=thickness,
        font=font,
        paper=paper,
        ink=ink,
        line=line,
        wobble=round(float(rng.uniform(0.6, 1.6)) * pitch / 18.0, 4) if line != "clean" else 0.0,
        dot_per_1000=round(dot, 4),
        jpeg_quality=int(rng.integers(quality[0], quality[1] + 1)),
        label_ports=bool(rng.random() < 0.9),
        label_supplies=bool(rng.random() < 0.6),
        label_devices=bool(rng.random() < 0.3),
        title=bool(rng.random() < 0.3),
    )


def _densify(pts: np.ndarray, step: float) -> np.ndarray:
    """
    Resample a polyline so consecutive points are at most `step` pixels apart.

    Args:
        pts: Nx2 vertices.
        step: Maximum spacing.
    Returns:
        Mx2 resampled points (original vertices kept).
    """
    out: list[np.ndarray] = []
    for a, b in zip(pts[:-1], pts[1:]):
        n = max(1, int(np.ceil(float(np.linalg.norm(b - a)) / step)))
        ts = np.arange(n, dtype=np.float64) / n
        out.append(a[None, :] + ts[:, None] * (b - a)[None, :])
    out.append(pts[-1:])
    return np.concatenate(out, axis=0)


def _wobble(pts: np.ndarray, rng: np.random.Generator, amp: float) -> np.ndarray:
    """
    Hand-drawn wobble: smooth low-frequency drift plus jitter, pinned to zero at both ends.

    Args:
        pts: Nx2 polyline in pixels.
        rng: Random generator.
        amp: Wobble amplitude in pixels.
    Returns:
        Wobbled dense polyline with the exact original endpoints.
    """
    dense = _densify(pts, 4.0)
    n = len(dense)
    if n < 3 or amp <= 0:
        return dense
    noise = rng.normal(0.0, 1.0, (n + 24, 2))
    kernel = np.hanning(25)
    kernel /= kernel.sum()
    smooth = np.stack([np.convolve(noise[:, i], kernel, mode="valid")[:n] for i in range(2)], axis=1) * 3.5
    t = np.linspace(0.0, 1.0, n)
    taper = np.sqrt(np.sin(np.pi * t))[:, None]
    jitter = rng.normal(0.0, 0.06, (n, 2))
    return dense + (smooth + jitter) * amp * taper


class _Canvas:
    """Ink mask plus bookkeeping of the exact drawn points per item."""

    def __init__(self, w: int, h: int, style: RenderStyle, rng: np.random.Generator) -> None:
        """
        Create an empty ink mask.

        Args:
            w: Width in pixels.
            h: Height in pixels.
            style: Render style.
            rng: Random generator.
        """
        self.mask = np.zeros((h, w), dtype=np.uint8)
        self.style = style
        self.rng = rng

    def stroke(self, pts: np.ndarray, thickness: int | None = None) -> np.ndarray:
        """
        Draw one polyline in the current line style.

        Args:
            pts: Nx2 polyline in pixels.
            thickness: Override thickness.
        Returns:
            All points actually drawn (for tight boxes).
        """
        t = thickness or self.style.thickness
        drawn: list[np.ndarray] = []
        if self.style.line == "clean":
            passes = [pts]
        elif self.style.line == "wobble":
            passes = [_wobble(pts, self.rng, self.style.wobble)]
        else:
            passes = [_wobble(pts, self.rng, self.style.wobble * 1.3) for _ in range(2)]
            t = max(1, t - 1)
        for p in passes:
            cv2.polylines(self.mask, [np.round(p * 16).astype(np.int32)], False, 255, t, cv2.LINE_AA, shift=4)
            drawn.append(p)
        return np.concatenate(drawn, axis=0)

    def fill(self, pts: np.ndarray) -> np.ndarray:
        """
        Fill a closed polygon.

        Args:
            pts: Nx2 polygon in pixels.
        Returns:
            The polygon points.
        """
        cv2.fillPoly(self.mask, [np.round(pts * 16).astype(np.int32)], 255, cv2.LINE_AA, shift=4)
        return pts

    def dot(self, center: tuple[float, float], diameter: float) -> None:
        """
        Filled junction dot.

        Args:
            center: Centre in pixels.
            diameter: Dot diameter in pixels.
        """
        c = (int(round(center[0] * 16)), int(round(center[1] * 16)))
        cv2.circle(self.mask, c, int(round(diameter / 2 * 16)), 255, -1, cv2.LINE_AA, shift=4)

    def text_size(self, text: str, height: float) -> tuple[float, int, int, int]:
        """
        Font scale and pixel size of a text for a target cap height.

        Args:
            text: String.
            height: Target text height in pixels.
        Returns:
            (scale, thickness, width, height).
        """
        font = FONTS[self.style.font]
        (_, h1), _ = cv2.getTextSize("A", font, 1.0, 1)
        scale = height / max(h1, 1)
        thick = max(1, round(self.style.thickness * 0.8))
        (w, h), _ = cv2.getTextSize(text, font, scale, thick)
        return scale, thick, w, h

    def text(self, text: str, org: tuple[float, float], scale: float, thick: int) -> None:
        """
        Draw text with its baseline-left corner at org.

        Args:
            text: String.
            org: Bottom-left corner in pixels.
            scale: Font scale.
            thick: Stroke thickness.
        """
        cv2.putText(self.mask, text, (int(round(org[0])), int(round(org[1]))), FONTS[self.style.font], scale, 255, thick, cv2.LINE_AA)


def _paper(w: int, h: int, paper: str, rng: np.random.Generator) -> np.ndarray:
    """
    Paper background.

    Args:
        w: Width.
        h: Height.
        paper: white | cream | lined | grid | noisy.
        rng: Random generator.
    Returns:
        HxWx3 float32 BGR image in [0, 255].
    """
    if paper == "white":
        return np.full((h, w, 3), 255.0, dtype=np.float32)
    base = float(rng.uniform(222, 248))
    tint = np.array([base - rng.uniform(4, 16), base - rng.uniform(0, 6), base], dtype=np.float32)
    img = np.empty((h, w, 3), dtype=np.float32)
    img[:] = tint
    if paper in ("lined", "grid"):
        spacing = float(rng.uniform(22, 34))
        color = np.array([205, 175, 150] if rng.random() < 0.6 else [170, 200, 170], dtype=np.float32)
        lines = np.zeros((h, w), dtype=np.float32)
        y = float(rng.uniform(0, spacing))
        while y < h:
            cv2.line(lines, (0, int(y)), (w, int(y)), 1.0, 1, cv2.LINE_AA)
            y += spacing
        if paper == "grid":
            x = float(rng.uniform(0, spacing))
            while x < w:
                cv2.line(lines, (int(x), 0), (int(x), h), 1.0, 1, cv2.LINE_AA)
                x += spacing
        a = (lines * 0.55)[:, :, None]
        img = img * (1 - a) + color * a
    noise = 6.0 if paper == "noisy" else 2.0
    img += rng.normal(0.0, noise, (h, w, 1)).astype(np.float32)
    return img


def _apply_photo(img: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """
    Phone-photo effects: perspective, uneven lighting, shadow, blur and sensor noise.

    Args:
        img: HxWx3 float32 image.
        rng: Random generator.
    Returns:
        (processed image, 3x3 homography applied to coordinates).
    """
    h, w = img.shape[:2]
    m = 0.035
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    jitter = rng.uniform(-m, m, (4, 2)) * np.array([w, h])
    dst = (src + jitter).astype(np.float32)
    homography = cv2.getPerspectiveTransform(src, dst)
    border = tuple(float(v) for v in np.median(img.reshape(-1, 3), axis=0))
    out = cv2.warpPerspective(img, homography, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=border)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    gx, gy = rng.uniform(-0.25, 0.25, 2)
    light = 1.0 + gx * (xx / w - 0.5) + gy * (yy / h - 0.5)
    vignette = 1.0 - 0.18 * (((xx / w - 0.5) ** 2 + (yy / h - 0.5) ** 2) * 2.0)
    out *= (light * vignette)[:, :, None]
    if rng.random() < 0.5:
        shadow = np.zeros((h, w), dtype=np.float32)
        cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        cv2.ellipse(shadow, (int(cx), int(cy)), (int(w * rng.uniform(0.2, 0.5)), int(h * rng.uniform(0.2, 0.5))), float(rng.uniform(0, 180)), 0, 360, 1.0, -1)
        shadow = cv2.GaussianBlur(shadow, (0, 0), sigmaX=w * 0.05)
        out *= (1.0 - 0.18 * shadow)[:, :, None]
    out = cv2.GaussianBlur(out, (0, 0), sigmaX=float(rng.uniform(0.5, 1.2)))
    out += rng.normal(0.0, float(rng.uniform(3, 7)), out.shape).astype(np.float32)
    return out, homography


def _transform(pts: np.ndarray, homography: np.ndarray | None) -> np.ndarray:
    """
    Apply a homography to Nx2 points (identity when None).

    Args:
        pts: Nx2 points.
        homography: 3x3 matrix or None.
    Returns:
        Transformed Nx2 points.
    """
    if homography is None or len(pts) == 0:
        return pts
    return cv2.perspectiveTransform(pts.reshape(-1, 1, 2).astype(np.float64), homography).reshape(-1, 2)


def _bbox(pts: np.ndarray, pad: float, w: int, h: int) -> list[float]:
    """
    Padded bounding box clipped to the image.

    Args:
        pts: Nx2 points.
        pad: Padding in pixels.
        w: Image width.
        h: Image height.
    Returns:
        [x1, y1, x2, y2] rounded to 0.01 px.
    """
    x1 = max(0.0, float(pts[:, 0].min()) - pad)
    y1 = max(0.0, float(pts[:, 1].min()) - pad)
    x2 = min(float(w), float(pts[:, 0].max()) + pad)
    y2 = min(float(h), float(pts[:, 1].max()) + pad)
    return [round(x1, 2), round(y1, 2), round(x2, 2), round(y2, 2)]


def _boxes_overlap(a: list[float], b: list[float]) -> bool:
    """
    Whether two [x1, y1, x2, y2] boxes intersect.

    Args:
        a: First box.
        b: Second box.
    Returns:
        True on overlap.
    """
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def render(layout: Layout, style: RenderStyle, rng: np.random.Generator) -> tuple[bytes, dict]:
    """
    Render a routed layout to an encoded JPEG plus exact annotations.

    Args:
        layout: Routed layout.
        style: Render style.
        rng: Random generator.
    Returns:
        (JPEG bytes, annotation dict with image size, symbols, junctions, wires, crossings, texts).
    """
    p = style.pitch
    w = int(round(layout.width * p))
    h = int(round(layout.height * p))

    def to_px(pts: np.ndarray) -> np.ndarray:
        """Grid units to pixel coordinates."""
        return (np.asarray(pts, dtype=np.float64) + 0.5) * p

    canvas = _Canvas(w, h, style, rng)
    pad = style.thickness / 2.0 + 1.0
    sym_records: list[dict] = []
    sym_points: list[np.ndarray] = []
    for sym in layout.symbols:
        geom = symbol_geometry(sym.cls, sym.variant)

        def world(pts: np.ndarray, sym: object = sym) -> np.ndarray:
            """Local symbol units to pixels for this symbol."""
            return to_px(orient_points(pts, sym.rotation, sym.mirror) + np.array(sym.anchor, dtype=np.float64))

        drawn = [canvas.stroke(world(s)) for s in geom.strokes]
        drawn += [canvas.fill(world(f)) for f in geom.fills]
        for text, center, size in geom.texts:
            c = world(np.array([center]))[0]
            scale, thick, tw, th = canvas.text_size(text, size * p * 0.55)
            canvas.text(text, (c[0] - tw / 2, c[1] + th / 2), scale, thick)
        sym_points.append(np.concatenate(drawn, axis=0))
        pins = sym.pins()
        sym_records.append(
            {
                "id": sym.comp_id,
                "class": sym.cls,
                "class_id": CLASS_ID[sym.cls],
                "variant": sym.variant,
                "orientation": {"rotation": sym.rotation, "mirror": sym.mirror},
                "pins": {t: to_px(np.array([pins[t]]))[0] for t in sorted(pins)},
                "nets": dict(sorted(sym.nets.items())),
            }
        )
    wires: list[dict] = []
    for net in layout.nets:
        name = layout.key_net[net.key]
        for poly in net.polylines:
            canvas.stroke(to_px(np.array(poly)))
            wires.append({"net": name, "points": to_px(np.array(poly))})
    diameter = style.dot_per_1000 * w / 1000.0
    junctions: list[dict] = []
    for net in layout.nets:
        for pt in net.junctions:
            c = to_px(np.array([pt]))[0]
            canvas.dot((c[0], c[1]), diameter)
            junctions.append({"net": layout.key_net[net.key], "center": c})

    sym_boxes = [_bbox(pts, pad, w, h) for pts in sym_points]
    dot_r = diameter / 2 + 1.0
    taken = sym_boxes + [[j["center"][0] - dot_r, j["center"][1] - dot_r, j["center"][0] + dot_r, j["center"][1] + dot_r] for j in junctions]
    texts = _place_texts(canvas, layout, style, sym_boxes, taken, to_px, rng)

    paper = _paper(w, h, style.paper, rng)
    ink = np.array(INKS[style.ink], dtype=np.float32)
    alpha = (canvas.mask.astype(np.float32) / 255.0) * (0.75 if style.ink == "pencil" else 1.0)
    img = paper * (1.0 - alpha[:, :, None]) + ink * alpha[:, :, None]
    homography: np.ndarray | None = None
    if style.mode == "photo":
        img, homography = _apply_photo(img, rng)
    elif style.mode == "hand":
        img = cv2.GaussianBlur(img, (0, 0), sigmaX=float(rng.uniform(0.3, 0.7)))
        img += rng.normal(0.0, float(rng.uniform(1.5, 4.0)), img.shape).astype(np.float32)
    elif style.mode == "textbook" and rng.random() < 0.5:
        img = cv2.GaussianBlur(img, (0, 0), sigmaX=float(rng.uniform(0.3, 0.6)))
    img_u8 = np.clip(np.round(img), 0, 255).astype(np.uint8)
    ok, enc = cv2.imencode(".jpg", img_u8, [cv2.IMWRITE_JPEG_QUALITY, style.jpeg_quality])
    if not ok:
        raise RuntimeError("JPEG encoding failed")

    for rec, pts in zip(sym_records, sym_points):
        rec["bbox"] = _bbox(_transform(pts, homography), pad, w, h)
        rec["pins"] = {t: [round(float(v), 2) for v in _transform(np.array([xy]), homography)[0]] for t, xy in rec["pins"].items()}
    for j in junctions:
        c = j["center"]
        ring = np.array([[c[0] + diameter / 2 * np.cos(a), c[1] + diameter / 2 * np.sin(a)] for a in np.linspace(0, 2 * np.pi, 12, endpoint=False)])
        tc = _transform(np.array([c]), homography)[0]
        j["center"] = [round(float(tc[0]), 2), round(float(tc[1]), 2)]
        j["diameter"] = round(diameter, 2)
        j["bbox"] = _bbox(_transform(ring, homography), 1.0, w, h)
    for wire in wires:
        wire["points"] = [[round(float(x), 2), round(float(y), 2)] for x, y in _transform(wire["points"], homography)]
    for t in texts:
        corners = np.array([[t["bbox"][0], t["bbox"][1]], [t["bbox"][2], t["bbox"][1]], [t["bbox"][2], t["bbox"][3]], [t["bbox"][0], t["bbox"][3]]])
        t["bbox"] = _bbox(_transform(corners, homography), 0.0, w, h)
    crossings = []
    for pt, a, b in layout.crossings:
        c = _transform(to_px(np.array([pt])), homography)[0]
        crossings.append({"nets": sorted([a, b]), "point": [round(float(c[0]), 2), round(float(c[1]), 2)]})
    annotation = {
        "image": {"width": w, "height": h},
        "render_style": asdict(style),
        "global_orientation": {"rotation": layout.global_orientation[0], "mirror": layout.global_orientation[1]},
        "symbols": sym_records,
        "junctions": junctions,
        "wires": wires,
        "crossings": crossings,
        "texts": texts,
    }
    return enc.tobytes(), annotation


def _place_texts(canvas: _Canvas, layout: Layout, style: RenderStyle, sym_boxes: list[list[float]], taken: list[list[float]], to_px: object, rng: np.random.Generator) -> list[dict]:
    """
    Draw port names, supply names, device names and a title where they collide with nothing.

    Args:
        canvas: Canvas whose mask already holds symbols, wires and dots.
        layout: Layout.
        style: Render style.
        sym_boxes: Pixel boxes of the symbols (same order as layout.symbols).
        taken: Boxes texts must avoid (symbols and junctions); extended in place.
        to_px: Grid-to-pixel function.
        rng: Random generator.
    Returns:
        Text records {"text", "bbox"} in pre-photo pixel coordinates.
    """
    h, w = canvas.mask.shape
    p = style.pitch
    gap = 0.35 * p
    texts: list[dict] = []

    def try_at(text: str, x0: float, y0: float, scale: float, thick: int, tw: int, th: int) -> bool:
        """Draw text with its top-left at (x0, y0) if the spot is inside the image and free."""
        tb = [x0 - 2, y0 - 3, x0 + tw + 2, y0 + th + 4]
        if tb[0] < 1 or tb[1] < 1 or tb[2] > w - 1 or tb[3] > h - 1:
            return False
        if any(_boxes_overlap(tb, b) for b in taken):
            return False
        region = canvas.mask[max(0, int(tb[1]) - 2) : int(tb[3]) + 3, max(0, int(tb[0]) - 2) : int(tb[2]) + 3]
        if region.size and int(region.max()) > 0:
            return False
        canvas.text(text, (x0, y0 + th), scale, thick)
        texts.append({"text": text, "bbox": [round(tb[0], 2), round(tb[1], 2), round(tb[2], 2), round(tb[3], 2)]})
        taken.append(tb)
        return True

    def try_place(text: str, box: list[float], side: tuple[int, int], size: float) -> None:
        """Place text next to box on the given side if the spot is free."""
        scale, thick, tw, th = canvas.text_size(text, size)
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        if side == (-1, 0):
            x0, y0 = box[0] - gap - tw, cy - th / 2
        elif side == (1, 0):
            x0, y0 = box[2] + gap, cy - th / 2
        elif side == (0, -1):
            x0, y0 = cx - tw / 2, box[1] - gap - th
        else:
            x0, y0 = cx - tw / 2, box[3] + gap
        try_at(text, x0, y0, scale, thick, tw, th)

    size = p * float(rng.uniform(0.75, 1.1))
    for sym, box in zip(layout.symbols, sym_boxes):
        dirs = sym.pin_dirs()
        if sym.cls in ("INPUT_PORT", "OUTPUT_PORT") and style.label_ports:
            d = next(iter(dirs.values()))
            try_place(sym.label, box, (-d[0], -d[1]), size)
        elif sym.cls in ("VDD", "GND") and style.label_supplies:
            d = next(iter(dirs.values()))
            name = sym.cls if rng.random() < 0.7 else ("Vdd" if sym.cls == "VDD" else "Vss")
            try_place(name, box, (-d[0], -d[1]), size * 0.8)
        elif sym.cls in ("NMOS", "PMOS") and style.label_devices:
            g = dirs["g"]
            try_place(sym.comp_id, box, (-g[0], -g[1]), size * 0.75)
    if style.title:
        title = TITLES[int(rng.integers(0, len(TITLES)))]
        scale, thick, tw, th = canvas.text_size(title, size * 1.2)
        for x0, y0 in ((p, p * 0.6), (w - tw - p, p * 0.6), (p, h - th - p), (w - tw - p, h - th - p)):
            if try_at(title, x0, y0, scale, thick, tw, th):
                break
    return texts
