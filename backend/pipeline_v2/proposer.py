"""
Module: proposer.py
Purpose: Region proposals for open-set recognition — finds *where* components
         are in a photo; *what* they are is decided later by retrieval + OCR
         (matcher.py). Primary proposer is prompt-free YOLOE (built-in open
         vocabulary, no text encoder download); a classical contour detector
         backs it up for clean plain-background shots and for machines where
         the model can't load. Duplicates are merged with IoU-based NMS.
"""

import os
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

_WEIGHTS_NAME = os.getenv("PROPOSER_WEIGHTS", "yoloe-11s-seg-pf.pt")
_CONFIDENCE = float(os.getenv("PROPOSER_CONFIDENCE", "0.08"))
_IMAGE_SIZE = 960
_NMS_IOU = 0.55
# Boxes outside this fraction-of-frame area range are noise / backgrounds.
_MIN_AREA_FRACTION = 0.001
_MAX_AREA_FRACTION = 0.65


@dataclass
class Proposal:
    """One candidate component region in the photo."""

    x1: float
    y1: float
    x2: float
    y2: float
    confidence: float
    # Open-vocab class guess ('circuit board', …) or 'region' for contours.
    hint: str
    source: str  # 'yoloe' | 'contour'

    @property
    def area(self) -> float:
        """
        Box area in square pixels.

        Returns:
            Width × height of the box.
        """
        return max(0.0, self.x2 - self.x1) * max(0.0, self.y2 - self.y1)


def _iou(a: Proposal, b: Proposal) -> float:
    """
    Intersection-over-union of two proposals.

    Args:
        a: First box.
        b: Second box.
    Returns:
        IoU in [0, 1].
    """
    ix1, iy1 = max(a.x1, b.x1), max(a.y1, b.y1)
    ix2, iy2 = min(a.x2, b.x2), min(a.y2, b.y2)
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = a.area + b.area - inter
    return inter / union if union > 0 else 0.0


def _nms(proposals: list[Proposal]) -> list[Proposal]:
    """
    Greedy non-maximum suppression (keeps the higher-confidence box).

    Args:
        proposals: Candidate boxes from all sources.
    Returns:
        De-duplicated proposals, highest confidence first.
    """
    ordered = sorted(proposals, key=lambda p: -p.confidence)
    kept: list[Proposal] = []
    for proposal in ordered:
        if all(_iou(proposal, existing) < _NMS_IOU for existing in kept):
            kept.append(proposal)
    return kept


def _contour_proposals(image: np.ndarray) -> list[Proposal]:
    """
    Classical fallback proposals: foreground blobs on a plain background.

    Edges (Canny) are dilated and merged into connected components; boxes with
    a plausible component-like area fraction become proposals. Works well for
    parts photographed on a desk/paper; not intended for dense breadboards.

    Args:
        image: Full BGR photo.
    Returns:
        Contour-derived proposals (confidence fixed at 0.30).
    """
    height, width = image.shape[:2]
    frame_area = float(height * width)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 40, 120)
    dilated = cv2.dilate(edges, np.ones((13, 13), np.uint8), iterations=2)
    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    proposals: list[Proposal] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        fraction = (w * h) / frame_area
        if _MIN_AREA_FRACTION <= fraction <= _MAX_AREA_FRACTION:
            proposals.append(
                Proposal(
                    x1=float(x),
                    y1=float(y),
                    x2=float(x + w),
                    y2=float(y + h),
                    confidence=0.30,
                    hint="region",
                    source="contour",
                )
            )
    return proposals


class ComponentProposer:
    """Finds candidate component regions in physical-build photos."""

    def __init__(self) -> None:
        """Load prompt-free YOLOE (downloads once); None-model means fallback only."""
        self._model = None
        try:
            from ultralytics import YOLOE

            self._model = YOLOE(_WEIGHTS_NAME)
        except (ImportError, OSError, RuntimeError, ValueError):
            self._model = None

    def propose(self, image_path: Path) -> list[Proposal]:
        """
        Propose component regions in a photo.

        Args:
            image_path: Path to the uploaded photo.
        Returns:
            NMS-merged proposals from YOLOE plus the classical fallback when
            YOLOE is unavailable or finds nothing.
        Raises:
            ValueError: When the file cannot be decoded as an image.
        """
        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError(f"Could not decode image: {image_path}")
        frame_area = float(image.shape[0] * image.shape[1])

        proposals: list[Proposal] = []
        if self._model is not None:
            results = self._model.predict(
                source=image,
                conf=_CONFIDENCE,
                imgsz=_IMAGE_SIZE,
                device="cpu",
                verbose=False,
            )
            for result in results:
                for box in result.boxes:
                    x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
                    fraction = ((x2 - x1) * (y2 - y1)) / frame_area
                    if not _MIN_AREA_FRACTION <= fraction <= _MAX_AREA_FRACTION:
                        continue
                    proposals.append(
                        Proposal(
                            x1=x1,
                            y1=y1,
                            x2=x2,
                            y2=y2,
                            confidence=float(box.conf[0]),
                            hint=str(result.names[int(box.cls[0])]),
                            source="yoloe",
                        )
                    )

        if not proposals:
            proposals = _contour_proposals(image)
        return _nms(proposals)


_proposer: ComponentProposer | None = None


def get_proposer() -> ComponentProposer:
    """
    Lazily construct the process-wide shared proposer.

    Returns:
        The cached ComponentProposer (its internal model may be None, in which
        case only contour proposals are produced).
    """
    global _proposer
    if _proposer is None:
        _proposer = ComponentProposer()
    return _proposer
