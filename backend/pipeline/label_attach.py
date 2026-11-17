"""
Module: label_attach.py
Purpose: OCR label attachment for the net tracer. Port and supply names are read where they
         are written - beside the symbol, on the side away from its wire: the isolated glyphs
         there are cropped tightly and passed to RapidOCR's recogniser alone (already a backend
         dependency, CPU ONNX; whole-page detection merges one-letter names with arrow heads
         and is several times slower). Text boxes, read or supplied, attach to the nearest port,
         supply or device symbol, or else to the nearest net. A net takes the name of the port
         on it when it has no text of its own. The recogniser is injectable for tests.
"""

from __future__ import annotations

from collections.abc import Callable

import cv2
import numpy as np

from pipeline.trace_types import Box, TextBox, TracedComponent, TracedNet

TextRecognizer = Callable[[np.ndarray], tuple[str, float] | None]

MIN_TEXT_CONFIDENCE = 0.5
PORT_CLASSES = frozenset({"INPUT_PORT", "OUTPUT_PORT"})
SUPPLY_CLASSES = frozenset({"VDD", "GND"})
LABELLED_CLASSES = PORT_CLASSES | SUPPLY_CLASSES
# Label search window beside a symbol, in multiples of the symbol's short side.
LABEL_REACH = 4.0
LABEL_HALF_HEIGHT = 0.9
# Glyphs of one label are at most this many short sides apart.
GLYPH_GAP = 0.6

_engine: object | None = None
_engine_error: str | None = None


def _rapidocr() -> object | None:
    """
    Lazily construct the shared RapidOCR engine.

    Returns:
        The RapidOCR instance, or None when it cannot be initialised (labels are then skipped).
    """
    global _engine, _engine_error
    if _engine is None and _engine_error is None:
        try:
            from rapidocr_onnxruntime import RapidOCR

            _engine = RapidOCR()
        except (ImportError, OSError, RuntimeError, ValueError) as exc:
            _engine_error = str(exc)
    return _engine


def rapidocr_recognizer(crop: np.ndarray) -> tuple[str, float] | None:
    """
    Recognise the text of one tight text crop with RapidOCR's recogniser (no detection stage).

    Args:
        crop: BGR uint8 crop holding one label.
    Returns:
        (text, confidence) when legible with confidence >= MIN_TEXT_CONFIDENCE, else None (also when OCR is unavailable).
    """
    engine = _rapidocr()
    if engine is None or crop.size == 0:
        return None
    try:
        result, _elapsed = engine(crop, use_det=False, use_cls=False, use_rec=True)
    except (RuntimeError, ValueError, cv2.error):
        return None
    if not result:
        return None
    text, conf = str(result[0][0]).strip(), float(result[0][1])
    return (text, conf) if text and conf >= MIN_TEXT_CONFIDENCE else None


def _label_window(comp: TracedComponent, width: int, height: int) -> tuple[int, int, int, int] | None:
    """
    Window beside a port or supply symbol where its name is written: on the side away from its wire.

    Args:
        comp: Component with at least one resolved pin point.
        width: Image width.
        height: Image height.
    Returns:
        (xa, ya, xb, yb) pixel window, or None when the symbol has no pin to orient by.
    """
    points = [p.point for p in comp.pins.values() if p.point is not None]
    if not points:
        return None
    x1, y1, x2, y2 = comp.box
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    px, py = points[0]
    short = max(4.0, min(x2 - x1, y2 - y1))
    reach, half = LABEL_REACH * short, LABEL_HALF_HEIGHT * short
    if abs(px - cx) >= abs(py - cy):
        xa, xb = (x2, x2 + reach) if px < cx else (x1 - reach, x1)
        ya, yb = cy - half, cy + half
    else:
        ya, yb = (y2, y2 + reach) if py < cy else (y1 - reach, y1)
        xa, xb = cx - reach / 2, cx + reach / 2
    xa, ya = max(0, int(xa)), max(0, int(ya))
    xb, yb = min(width, int(np.ceil(xb))), min(height, int(np.ceil(yb)))
    return (xa, ya, xb, yb) if xb - xa > 2 and yb - ya > 2 else None


def _text_box(ink: np.ndarray, window: tuple[int, int, int, int], anchor: Box, short: float) -> Box | None:
    """
    Tight box of the label glyphs in a window: ink blobs not touching the window border (wires do), grown
    from the blob nearest the symbol through neighbours closer than GLYPH_GAP short sides.

    Args:
        ink: Bool ink mask of the whole image.
        window: Search window (xa, ya, xb, yb).
        anchor: The symbol's box (glyph growth starts next to it).
        short: The symbol's short side in pixels.
    Returns:
        Text box in image pixels, or None when the window holds no isolated glyphs.
    """
    xa, ya, xb, yb = window
    crop = ink[ya:yb, xa:xb].astype(np.uint8)
    n, _, stats, _ = cv2.connectedComponentsWithStats(crop, connectivity=8)
    h, w = crop.shape
    blobs = []
    for i in range(1, n):
        x, y, bw, bh, area = (int(v) for v in stats[i])
        if x == 0 or y == 0 or x + bw >= w or y + bh >= h or area < 3:
            continue
        blobs.append((x + xa, y + ya, x + xa + bw, y + ya + bh))
    if not blobs:
        return None
    remaining = sorted(blobs, key=lambda b: box_distance(b, anchor))
    group = [remaining.pop(0)]
    grown = True
    while grown:
        grown = False
        for b in list(remaining):
            if min(box_distance(b, g) for g in group) <= GLYPH_GAP * short:
                group.append(b)
                remaining.remove(b)
                grown = True
    return (min(b[0] for b in group), min(b[1] for b in group), max(b[2] for b in group), max(b[3] for b in group))


def read_labels(image: np.ndarray, ink: np.ndarray, components: list[TracedComponent], recognizer: TextRecognizer) -> list[TextBox]:
    """
    Read the names written beside port and supply symbols.

    Args:
        image: BGR uint8 image.
        ink: Bool ink mask of the image.
        components: Traced components (pins resolved).
        recognizer: Recogniser for one tight text crop.
    Returns:
        Text boxes in image pixels.
    """
    height, width = ink.shape
    texts: list[TextBox] = []
    for comp in components:
        if comp.class_name not in LABELLED_CLASSES:
            continue
        window = _label_window(comp, width, height)
        if window is None:
            continue
        short = max(4.0, min(comp.box[2] - comp.box[0], comp.box[3] - comp.box[1]))
        box = _text_box(ink, window, comp.box, short)
        if box is None:
            continue
        pad = max(2, int(0.15 * (box[3] - box[1])))
        xa, ya = max(0, int(box[0]) - pad), max(0, int(box[1]) - pad)
        xb, yb = min(width, int(box[2]) + pad), min(height, int(box[3]) + pad)
        read = recognizer(image[ya:yb, xa:xb])
        if read is not None:
            texts.append(TextBox(text=read[0], box=box, confidence=read[1]))
    return texts


def box_distance(a: Box, b: Box) -> float:
    """
    Gap between two axis-aligned boxes (0 when they overlap).

    Args:
        a: First box.
        b: Second box.
    Returns:
        Euclidean gap in pixels.
    """
    dx = max(0.0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0.0, max(a[1], b[1]) - min(a[3], b[3]))
    return float(np.hypot(dx, dy))


def _net_distance(box: Box, pixels: np.ndarray) -> float:
    """
    Distance from a text box to the nearest wire pixel of a net.

    Args:
        box: Text box.
        pixels: (n, 2) wire pixels (x, y) of the net.
    Returns:
        Distance in pixels (inf for an empty net).
    """
    if pixels.size == 0:
        return float("inf")
    dx = np.maximum(0.0, np.maximum(box[0] - pixels[:, 0], pixels[:, 0] - box[2]))
    dy = np.maximum(0.0, np.maximum(box[1] - pixels[:, 1], pixels[:, 1] - box[3]))
    return float(np.sqrt(dx * dx + dy * dy).min())


def attach_labels(texts: list[TextBox], components: list[TracedComponent], nets: list[TracedNet], net_pixels: dict[str, np.ndarray], reach: float) -> None:
    """
    Attach text to components and nets in place.

    Args:
        texts: OCR text boxes.
        components: Traced components (labels are set on ports, supplies and devices).
        nets: Traced nets (labels are set on nets).
        net_pixels: Net id -> wire pixels (x, y), for text that labels a wire directly.
        reach: Largest text-to-symbol (or text-to-wire) gap that still counts as labelling it.
    """
    best_for_component: dict[str, tuple[float, str]] = {}
    best_for_net: dict[str, tuple[float, str]] = {}
    for t in texts:
        scored = [(box_distance(t.box, c.box) * (0.7 if c.class_name in PORT_CLASSES else 1.0), c) for c in components if c.class_name != "JUNCTION"]
        scored = [(d, c) for d, c in scored if d <= reach]
        if scored:
            d, comp = min(scored, key=lambda dc: dc[0])
            prev = best_for_component.get(comp.id)
            if prev is None or d < prev[0]:
                best_for_component[comp.id] = (d, t.text)
            continue
        dists = [(_net_distance(t.box, net_pixels.get(n.id, np.empty((0, 2)))), n) for n in nets]
        dists = [(d, n) for d, n in dists if d <= reach]
        if dists:
            d, net = min(dists, key=lambda dn: dn[0])
            prev = best_for_net.get(net.id)
            if prev is None or d < prev[0]:
                best_for_net[net.id] = (d, t.text)
    for comp in components:
        if comp.id in best_for_component:
            comp.label = best_for_component[comp.id][1]
    by_id = {c.id: c for c in components}
    for net in nets:
        if net.id in best_for_net:
            net.label = best_for_net[net.id][1]
            continue
        for pin in net.pins:
            comp = by_id[pin.partition(":")[0]]
            if comp.class_name in PORT_CLASSES and comp.label:
                net.label = comp.label
                break
        else:
            for pin in net.pins:
                comp = by_id[pin.partition(":")[0]]
                if comp.class_name in SUPPLY_CLASSES:
                    net.label = comp.label or ("VDD" if comp.class_name == "VDD" else "GND")
                    break
