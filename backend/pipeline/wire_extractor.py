"""
Module: wire_extractor.py
Purpose: Classical OpenCV wire extraction stage — traces wire segments between gates
         using pixel-level line detection. No neural networks used here.
"""

from dataclasses import dataclass
from pathlib import Path


@dataclass
class WireSegment:
    """A single wire segment expressed as pixel start/end coordinates."""

    x1: int
    y1: int
    x2: int
    y2: int


class WireExtractor:
    """Extracts wire connections from a circuit image via classical CV (OpenCV only)."""

    def extract(self, image_path: Path) -> list[WireSegment]:
        """
        Detect wire segments in a circuit image.

        Args:
            image_path: Path to the input circuit image.
        Returns:
            List of WireSegment objects representing detected wire paths.
        Raises:
            NotImplementedError: Until Phase 3 implementation is complete.
            FileNotFoundError: If image_path does not exist.
        """
        if not image_path.exists():
            raise FileNotFoundError(f"Image not found: {image_path}")
        raise NotImplementedError(
            "Wire extraction not yet implemented. Complete Phase 1 training first."
        )
