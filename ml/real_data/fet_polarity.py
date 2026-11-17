"""
Module: fet_polarity.py
Purpose: The NMOS/PMOS relabelling pass for CGHD `transistor.fet`, which has no polarity in the source data.
         We label by eye on one reference photo per drawing (review sheets with numbered boxes and crops), store
         those decisions in a small committed JSON, and propagate them to the other photos of the same drawing by
         matching transistor positions. Anything that cannot be matched with confidence is left UNCERTAIN, so it
         is flagged and kept out of the labels rather than guessed.
"""

import json
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps
from scipy.optimize import linear_sum_assignment

from real_data.cghd import VocAnnotation, VocObject
from real_data.class_remap import CGHD_FET

VALID_POLARITY = ("NMOS", "PMOS", "UNCERTAIN")
# Largest normalised distance between a matched pair of transistors before the match is rejected.
MAX_MATCH_RESIDUAL = 0.15
# A matched pair must be at least this many times closer than the pair's next-best candidate.
MIN_MATCH_MARGIN = 2.0
_DRAWING = re.compile(r"^(?P<drawing>C-?\d+_D\d+)_P\d+$")


@dataclass(frozen=True)
class FetMatch:
    """Result of matching one photo's transistors onto the reference photo's."""

    mapping: dict[int, int]
    residual: float


def drawing_of(stem: str) -> str:
    """
    Drawing id of a CGHD image stem (the circuit and drawing, without the photo number).

    Args:
        stem: e.g. "C181_D2_P3".
    Returns:
        e.g. "C181_D2".
    Raises:
        ValueError: If the stem does not look like a CGHD image name.
    """
    match = _DRAWING.match(stem)
    if not match:
        raise ValueError(f"Not a CGHD image stem: {stem}")
    return match.group("drawing")


def fet_objects(ann: VocAnnotation) -> list[VocObject]:
    """
    The transistor.fet objects of an annotation in file order (the ordinal used in polarity keys).

    Args:
        ann: Parsed annotation.
    Returns:
        The FET objects, file order.
    """
    return [o for o in ann.objects if o.name == CGHD_FET]


def _normalised_centres(fets: list[VocObject]) -> np.ndarray:
    """
    Box centres rescaled to the unit square spanned by the transistors themselves.

    Args:
        fets: Transistors of one photo.
    Returns:
        (n, 2) array. An axis on which all transistors coincide maps to 0.5.
    """
    pts = np.array([[(o.xmin + o.xmax) / 2, (o.ymin + o.ymax) / 2] for o in fets], dtype=float)
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    span = hi - lo
    out = np.full_like(pts, 0.5)
    for axis in (0, 1):
        if span[axis] > 1e-6:
            out[:, axis] = (pts[:, axis] - lo[axis]) / span[axis]
    return out


def match_fets(reference: list[VocObject], other: list[VocObject]) -> FetMatch | None:
    """
    Match another photo's transistors onto the reference photo's by relative position.

    Args:
        reference: Transistors of the reference photo.
        other: Transistors of the photo to label.
    Returns:
        Mapping other-ordinal -> reference-ordinal and the worst matched distance, or None when the photos
        disagree on the transistor count or some transistor has two near-equal candidates (ambiguous).
    """
    if len(reference) != len(other) or not reference:
        return None
    ref_pts, oth_pts = _normalised_centres(reference), _normalised_centres(other)
    cost = np.linalg.norm(oth_pts[:, None, :] - ref_pts[None, :, :], axis=2)
    rows, cols = linear_sum_assignment(cost)
    for r, c in zip(rows, cols, strict=True):
        rivals = np.delete(cost[r], c)
        if rivals.size and cost[r, c] * MIN_MATCH_MARGIN > rivals.min():
            return None
    return FetMatch({int(r): int(c) for r, c in zip(rows, cols, strict=True)}, float(cost[rows, cols].max()))


def load_polarity(path: Path) -> dict[str, dict[str, str]]:
    """
    Load our reference polarity decisions.

    Args:
        path: fet_polarity.json.
    Returns:
        Reference image key ("drafter_16/C181_D1_P1") -> {FET ordinal as string: NMOS, PMOS or UNCERTAIN}.
    Raises:
        ValueError: If a decision is not one of NMOS, PMOS, UNCERTAIN.
    """
    if not path.exists():
        return {}
    refs: dict[str, dict[str, str]] = json.loads(path.read_text())["reference"]
    for image, labels in refs.items():
        for ordinal, value in labels.items():
            if value not in VALID_POLARITY:
                raise ValueError(f"{path}: {image}#{ordinal} has invalid polarity {value!r}")
    return refs


def propagate_polarity(
    refs: dict[str, dict[str, str]],
    annotations: dict[str, VocAnnotation],
) -> tuple[dict[str, str], dict[str, float]]:
    """
    Expand the reference decisions to every photo of the same drawings.

    A drawing whose reference transistors all share one polarity needs no matching: every transistor of every
    photo gets that polarity. A mixed drawing is matched by position, and only trusted when the photo has the
    same orientation (landscape/portrait) as the reference, the same transistor count, a small worst distance
    and an unambiguous assignment.

    Args:
        refs: Reference decisions from load_polarity.
        annotations: Image key ("drafter_16/C181_D1_P2") -> parsed annotation, for every pilot image.
    Returns:
        (labels, residuals): labels maps "<image key>#<ordinal>" to NMOS, PMOS or UNCERTAIN for every FET of
        every image; residuals maps the key of each position-matched photo to its worst match distance.
        FETs of drawings with no reference decision, or whose photo cannot be matched, are UNCERTAIN.
    Raises:
        ValueError: If a reference image is unknown or its decisions do not cover its transistors exactly.
    """
    by_drawing: dict[str, str] = {}
    for key, decisions in refs.items():
        if key not in annotations:
            raise ValueError(f"Reference image {key} is not among the pilot annotations")
        count = len(fet_objects(annotations[key]))
        if sorted(int(o) for o in decisions) != list(range(count)):
            raise ValueError(f"{key}: {len(decisions)} decisions for {count} transistors")
        folder, stem = key.split("/")
        by_drawing[f"{folder}/{drawing_of(stem)}"] = key
    labels: dict[str, str] = {}
    residuals: dict[str, float] = {}
    for key, ann in sorted(annotations.items()):
        folder, stem = key.split("/")
        fets = fet_objects(ann)
        ref_key = by_drawing.get(f"{folder}/{drawing_of(stem)}")
        values = [""] * len(fets)
        if ref_key is not None:
            decisions = refs[ref_key]
            ref_ann = annotations[ref_key]
            if len(set(decisions.values())) == 1:
                values = [next(iter(decisions.values()))] * len(fets)
            elif ref_key == key:
                values = [decisions[str(i)] for i in range(len(fets))]
            elif (ann.width >= ann.height) == (ref_ann.width >= ref_ann.height):
                match = match_fets(fet_objects(ref_ann), fets)
                if match is not None and match.residual <= MAX_MATCH_RESIDUAL:
                    residuals[key] = match.residual
                    values = [decisions[str(match.mapping[i])] for i in range(len(fets))]
        for ordinal, value in enumerate(values):
            labels[f"{key}#{ordinal}"] = value or "UNCERTAIN"
    return labels, residuals


def upright_image(path: Path) -> Image.Image:
    """
    Open an image with its EXIF orientation applied (the frame the annotations use).

    Args:
        path: Image file.
    Returns:
        The upright RGB image.
    """
    with Image.open(path) as im:
        return ImageOps.exif_transpose(im).convert("RGB")


def render_review_sheet(image_path: Path, fets: list[VocObject], title: str, out_path: Path, per_sheet: int = 8) -> list[Path]:
    """
    Draw review sheets for one reference photo: the photo with numbered boxes, then numbered close-up crops.

    Args:
        image_path: The reference photo.
        fets: Its transistor objects, in ordinal order.
        title: Label drawn on the sheet.
        out_path: Output path stem; sheets are written as <stem>_a.png, <stem>_b.png, ...
        per_sheet: Crops per sheet.
    Returns:
        Paths of the sheets written.
    """
    img = upright_image(image_path)
    overview = img.copy()
    draw = ImageDraw.Draw(overview)
    line = max(2, img.width // 400)
    for n, obj in enumerate(fets):
        draw.rectangle([obj.xmin, obj.ymin, obj.xmax, obj.ymax], outline=(255, 0, 0), width=line)
        draw.text((obj.xmin, max(0, obj.ymin - 4 * line)), str(n), fill=(255, 0, 0), font_size=max(14, img.width // 60))
    overview.thumbnail((1100, 1100))
    sheets: list[Path] = []
    for sheet_no, start in enumerate(range(0, len(fets), per_sheet)):
        chunk = fets[start : start + per_sheet]
        tiles = []
        for n, obj in enumerate(chunk, start=start):
            pad = 0.9 * max(obj.xmax - obj.xmin, obj.ymax - obj.ymin)
            crop = img.crop((int(max(0, obj.xmin - pad)), int(max(0, obj.ymin - pad)), int(obj.xmax + pad), int(obj.ymax + pad)))
            crop.thumbnail((330, 330))
            tile = Image.new("RGB", (340, 360), "white")
            tile.paste(crop, (5, 25))
            ImageDraw.Draw(tile).text((8, 4), f"#{n}  rot={obj.rotation}", fill=(200, 0, 0), font_size=18)
            tiles.append(tile)
        cols = 4
        rows = (len(tiles) + cols - 1) // cols
        grid = Image.new("RGB", (cols * 340, rows * 360), "white")
        for i, tile in enumerate(tiles):
            grid.paste(tile, ((i % cols) * 340, (i // cols) * 360))
        width = max(overview.width, grid.width)
        sheet = Image.new("RGB", (width, overview.height + grid.height + 30), "white")
        ImageDraw.Draw(sheet).text((5, 3), title, fill=(0, 0, 0), font_size=20)
        sheet.paste(overview, (0, 30))
        sheet.paste(grid, (0, overview.height + 30))
        path = out_path.with_name(f"{out_path.name}_{chr(ord('a') + sheet_no)}.png")
        sheet.save(path)
        sheets.append(path)
    return sheets
