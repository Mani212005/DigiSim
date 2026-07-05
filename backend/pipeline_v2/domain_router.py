"""
Module: domain_router.py
Purpose: Decide whether an uploaded circuit image is a schematic drawing (white
         paper, low saturation, high-contrast ink — handled by the existing
         gate-symbol pipeline) or a photo of a physical build (colorful,
         textured — handled by the open-set recognition pipeline). Pure
         classical statistics, no ML, so routing is instant and explainable.
"""

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

# Drawings are nearly grayscale; photos have saturated pixels.
_SATURATION_LEVEL = 60
_MAX_SCHEMATIC_SAT_FRACTION = 0.08
# Paper backgrounds keep most of the frame bright.
_BRIGHT_LEVEL = 200
_MIN_SCHEMATIC_BRIGHT_FRACTION = 0.45


@dataclass
class DomainDecision:
    """Routing decision with the signals that produced it."""

    domain: str  # 'schematic' | 'photo'
    saturated_fraction: float
    bright_fraction: float


def classify_image(image_path: Path) -> DomainDecision:
    """
    Classify a circuit image as a schematic drawing or a physical-build photo.

    Args:
        image_path: Path to the uploaded image.
    Returns:
        DomainDecision with the chosen domain and its supporting statistics.
    Raises:
        ValueError: When the file cannot be decoded as an image.
    """
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Could not decode image: {image_path}")

    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    saturated = float(np.mean(hsv[:, :, 1] > _SATURATION_LEVEL))
    bright = float(np.mean(hsv[:, :, 2] > _BRIGHT_LEVEL))

    is_schematic = (
        saturated < _MAX_SCHEMATIC_SAT_FRACTION
        and bright > _MIN_SCHEMATIC_BRIGHT_FRACTION
    )
    return DomainDecision(
        domain="schematic" if is_schematic else "photo",
        saturated_fraction=round(saturated, 4),
        bright_fraction=round(bright, 4),
    )
