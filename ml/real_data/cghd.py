"""
Module: cghd.py
Purpose: Reads CGHD PASCAL VOC annotation files and converts them to DigiSim YOLO labels using the class
         remap in class_remap.py. Handles the three cases a plain rename cannot: transistor.fet (needs
         a polarity decision), terminal (needs its neighbouring text label) and every unmapped class
         (recorded as an ignore region so the evaluator can mask it instead of counting a false positive).
"""

import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

from real_data.class_remap import CGHD_DIRECT, CGHD_FET, CGHD_SUPPLY, CGHD_TERMINAL, CGHD_TEXT, classify_supply, classify_terminal

# A terminal's label must sit within this many terminal-box diagonals of the terminal.
TERMINAL_TEXT_REACH = 3.0
# Boxes smaller than this in either side (pixels) are annotation noise.
MIN_BOX_SIDE = 4.0


@dataclass(frozen=True)
class VocObject:
    """One <object> of a CGHD VOC file."""

    index: int
    name: str
    xmin: float
    ymin: float
    xmax: float
    ymax: float
    rotation: int | None
    text: str | None


@dataclass(frozen=True)
class VocAnnotation:
    """A parsed CGHD VOC file."""

    filename: str
    width: int
    height: int
    objects: tuple[VocObject, ...]


@dataclass(frozen=True)
class LabelBox:
    """A labelled box in pixel coordinates with a DigiSim class name."""

    class_name: str
    xmin: float
    ymin: float
    xmax: float
    ymax: float


@dataclass(frozen=True)
class IgnoredBox:
    """A source box that is not a training label: unmapped class or an undecided FET/terminal."""

    reason: str
    source_class: str
    xmin: float
    ymin: float
    xmax: float
    ymax: float


@dataclass(frozen=True)
class ConvertedImage:
    """Labels and ignore regions produced from one CGHD annotation."""

    boxes: tuple[LabelBox, ...]
    ignored: tuple[IgnoredBox, ...]


def parse_voc(path: Path) -> VocAnnotation:
    """
    Parse one CGHD PASCAL VOC annotation file.

    Args:
        path: Path to the .xml file.
    Returns:
        The parsed annotation with objects in file order (the order is the stable per-image object index).
    Raises:
        FileNotFoundError: If the file does not exist.
        ValueError: If the XML is malformed or lacks size or box fields.
    """
    if not path.exists():
        raise FileNotFoundError(path)
    try:
        root = ET.parse(path).getroot()
        size = root.find("size")
        if size is None:
            raise ValueError("missing <size>")
        width, height = int(size.findtext("width", "")), int(size.findtext("height", ""))
        objects = []
        for index, obj in enumerate(root.iter("object")):
            box = obj.find("bndbox")
            if box is None:
                raise ValueError(f"object {index} has no <bndbox>")
            rotation = box.findtext("rotation")
            objects.append(
                VocObject(
                    index=index,
                    name=obj.findtext("name", ""),
                    xmin=float(box.findtext("xmin", "")),
                    ymin=float(box.findtext("ymin", "")),
                    xmax=float(box.findtext("xmax", "")),
                    ymax=float(box.findtext("ymax", "")),
                    rotation=int(float(rotation)) if rotation else None,
                    text=obj.findtext("text"),
                )
            )
    except (ET.ParseError, ValueError, TypeError) as exc:
        raise ValueError(f"{path}: malformed VOC annotation: {exc}") from exc
    return VocAnnotation(filename=root.findtext("filename", path.stem), width=width, height=height, objects=tuple(objects))


def _gap(a: VocObject, b: VocObject) -> float:
    """
    Distance between two boxes' edges (0 when they overlap).

    Args:
        a: First object.
        b: Second object.
    Returns:
        Euclidean gap in pixels.
    """
    dx = max(a.xmin - b.xmax, b.xmin - a.xmax, 0.0)
    dy = max(a.ymin - b.ymax, b.ymin - a.ymax, 0.0)
    return math.hypot(dx, dy)


def nearest_text(terminal: VocObject, texts: list[VocObject]) -> str | None:
    """
    The label of the text box closest to a terminal, if it is close enough to plausibly belong to it.

    Args:
        terminal: The terminal object.
        texts: All `text` objects of the same image.
    Returns:
        The nearest text label, or None when no labelled text is within reach.
    """
    reach = TERMINAL_TEXT_REACH * math.hypot(terminal.xmax - terminal.xmin, terminal.ymax - terminal.ymin)
    best: tuple[float, str] | None = None
    for text in texts:
        if not text.text:
            continue
        gap = _gap(terminal, text)
        if gap <= reach and (best is None or gap < best[0]):
            best = (gap, text.text)
    return best[1] if best else None


def convert_annotation(ann: VocAnnotation, fet_polarity: dict[str, str], key_prefix: str) -> ConvertedImage:
    """
    Convert one CGHD annotation to DigiSim labels and ignore regions.

    Args:
        ann: The parsed VOC annotation.
        fet_polarity: Our polarity decisions, key "<key_prefix>#<n>" (n = index among this image's transistor.fet
            objects) to NMOS, PMOS or UNCERTAIN. A missing key counts as UNCERTAIN.
        key_prefix: Image identity used in the polarity keys, e.g. "drafter_20/C46_D1_P1".
    Returns:
        The labelled boxes and the ignored boxes (reason `unmapped`, `uncertain_fet`, `uncertain_terminal` or `uncertain_supply`).
    """
    texts = [o for o in ann.objects if o.name == CGHD_TEXT]
    boxes: list[LabelBox] = []
    ignored: list[IgnoredBox] = []
    fet_seen = 0
    for obj in ann.objects:
        decision = "UNCERTAIN"
        if obj.name == CGHD_FET:
            decision = fet_polarity.get(f"{key_prefix}#{fet_seen}", "UNCERTAIN")
            fet_seen += 1
        if obj.xmax - obj.xmin < MIN_BOX_SIDE or obj.ymax - obj.ymin < MIN_BOX_SIDE:
            continue
        target: str | None = None
        reason = "unmapped"
        if obj.name in CGHD_DIRECT:
            target = CGHD_DIRECT[obj.name]
        elif obj.name == CGHD_FET:
            target = decision if decision in ("NMOS", "PMOS") else None
            reason = "uncertain_fet"
        elif obj.name in CGHD_SUPPLY:
            target = classify_supply(nearest_text(obj, texts))
            reason = "uncertain_supply"
        elif obj.name == CGHD_TERMINAL:
            target = classify_terminal(nearest_text(obj, texts))
            reason = "uncertain_terminal"
        elif obj.name == CGHD_TEXT:
            continue
        if target is None:
            ignored.append(IgnoredBox(reason, obj.name, obj.xmin, obj.ymin, obj.xmax, obj.ymax))
        else:
            boxes.append(LabelBox(target, obj.xmin, obj.ymin, obj.xmax, obj.ymax))
    return ConvertedImage(tuple(boxes), tuple(ignored))


def drafter_of(path: Path) -> int:
    """
    Drafter number from a path that contains a `drafter_<n>` directory.

    Args:
        path: Any path inside a drafter folder.
    Returns:
        The drafter number (may be 0 or negative for the non-standard CGHD drafters).
    Raises:
        ValueError: If no drafter_<n> component is present.
    """
    for part in path.parts:
        if part.startswith("drafter_"):
            return int(part.split("_", 1)[1])
    raise ValueError(f"No drafter_<n> directory in {path}")
