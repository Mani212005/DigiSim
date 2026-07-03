"""
Module: wire_extractor.py
Purpose: Classical OpenCV wire extraction stage — traces wire segments between gates
         using pixel-level line detection. No neural networks used here.

Approach:
    1. Adaptive threshold isolates dark pen ink from the paper background.
    2. Detected gate boxes are erased so only wires (and stray text) remain.
       Junction dots are intentionally NOT erased — they keep branching nets
       connected as single ink components.
    3. Small compact components (handwritten text) are removed; elongated or
       large components are kept as wire ink.
    4. Probabilistic Hough transform converts wire ink into line segments.
"""

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


@dataclass
class WireSegment:
    """A single wire segment expressed as pixel start/end coordinates."""

    x1: int
    y1: int
    x2: int
    y2: int

    @property
    def endpoints(self) -> tuple[tuple[int, int], tuple[int, int]]:
        """
        Segment endpoints.

        Returns:
            ((x1, y1), (x2, y2)) tuple pair.
        """
        return ((self.x1, self.y1), (self.x2, self.y2))


class WireExtractor:
    """Extracts wire connections from a circuit image via classical CV (OpenCV only)."""

    def __init__(
        self,
        min_line_length: int = 22,
        max_line_gap: int = 14,
        min_component_diag: float = 45.0,
    ) -> None:
        """
        Initialise the extractor.

        Args:
            min_line_length: Minimum Hough segment length in pixels.
            max_line_gap: Maximum gap bridged inside one Hough segment.
            min_component_diag: Ink components with a smaller bounding-box
                diagonal are treated as text/noise and discarded.
        """
        self.min_line_length = min_line_length
        self.max_line_gap = max_line_gap
        self.min_component_diag = min_component_diag

    def _ink_mask(self, image: np.ndarray) -> np.ndarray:
        """
        Binarise the image so pen ink is white on black.

        Args:
            image: BGR input image.
        Returns:
            uint8 binary mask of ink pixels.
        """
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (3, 3), 0)
        return cv2.adaptiveThreshold(
            gray,
            255,
            cv2.ADAPTIVE_THRESH_MEAN_C,
            cv2.THRESH_BINARY_INV,
            35,
            12,
        )

    def _remove_text_noise(self, mask: np.ndarray) -> np.ndarray:
        """
        Drop compact ink blobs (handwritten labels, specks) from the mask.

        Args:
            mask: Binary ink mask (modified copy is returned).
        Returns:
            Cleaned binary mask containing only wire-like components.
        """
        n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        cleaned = np.zeros_like(mask)
        for i in range(1, n):
            x, y, w, h, area = stats[i]
            diag = float(np.hypot(w, h))
            elongation = max(w, h) / max(1, min(w, h))
            # Wires are long/thin or span large extents; text blobs are compact.
            if diag >= self.min_component_diag and (elongation >= 2.2 or diag > 140):
                cleaned[labels == i] = 255
        return cleaned

    def extract(
        self,
        image_path: Path,
        exclude_boxes: list[tuple[float, float, float, float]] | None = None,
    ) -> list[WireSegment]:
        """
        Detect wire segments in a circuit image.

        Args:
            image_path: Path to the input circuit image.
            exclude_boxes: Gate bounding boxes (x1, y1, x2, y2) to erase before
                tracing so gate bodies are not mistaken for wires. Junction
                boxes must not be included here.
        Returns:
            List of WireSegment objects representing detected wire paths.
        Raises:
            FileNotFoundError: If image_path does not exist.
            ValueError: If the image cannot be decoded.
        """
        if not image_path.exists():
            raise FileNotFoundError(f"Image not found: {image_path}")
        image = cv2.imread(str(image_path))
        if image is None:
            raise ValueError(f"Could not decode image: {image_path}")

        mask = self._ink_mask(image)

        h, w = mask.shape
        for x1, y1, x2, y2 in exclude_boxes or []:
            xa, ya = max(0, int(x1)), max(0, int(y1))
            xb, yb = min(w, int(x2)), min(h, int(y2))
            mask[ya:yb, xa:xb] = 0

        mask = self._remove_text_noise(mask)
        # Bridge small breaks left by erasing boxes over wire endpoints.
        mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=1)

        lines = cv2.HoughLinesP(
            mask,
            rho=1,
            theta=np.pi / 180,
            threshold=28,
            minLineLength=self.min_line_length,
            maxLineGap=self.max_line_gap,
        )
        if lines is None:
            return []
        return [
            WireSegment(int(x1), int(y1), int(x2), int(y2))
            for x1, y1, x2, y2 in lines[:, 0]
        ]
