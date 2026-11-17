"""
Module: ink.py
Purpose: Ink binarisation and scale estimation for the net tracer (classical OpenCV, no neural
         networks). Normalises uneven lighting against a morphological background estimate so
         faint ruled-paper lines and photo shading drop out while pen and pencil strokes stay,
         and measures the stroke width that every size-relative tracing threshold scales with.
"""

from __future__ import annotations

import cv2
import numpy as np

# A pixel is ink when it is darker than this fraction of the local paper brightness. Ruled-paper
# lines blend to about 0.85 of the paper, pencil strokes to about 0.55, pen ink to under 0.3.
INK_RATIO = 0.72
# Background kernel as a fraction of the longer image side (must exceed the largest junction dot).
BACKGROUND_KERNEL_FRACTION = 0.03
MIN_BACKGROUND_KERNEL = 15
# The paper background is smooth, so it is estimated on a copy whose longer side is at most this many pixels.
BACKGROUND_MAX_SIDE = 1000


def _odd(n: float) -> int:
    """
    Round to the nearest odd integer >= 3.

    Args:
        n: Size.
    Returns:
        Odd kernel size.
    """
    k = max(3, int(round(n)))
    return k if k % 2 else k + 1


def to_gray(image: np.ndarray) -> np.ndarray:
    """
    Convert an image to single-channel float32 grayscale.

    Args:
        image: BGR, BGRA or grayscale uint8 image.
    Returns:
        HxW float32 array in [0, 255].
    """
    if image.ndim == 2:
        return image.astype(np.float32)
    code = cv2.COLOR_BGRA2GRAY if image.shape[2] == 4 else cv2.COLOR_BGR2GRAY
    return cv2.cvtColor(image, code).astype(np.float32)


def ink_mask(image: np.ndarray) -> np.ndarray:
    """
    Binarise pen/pencil ink against an estimated paper background.

    Args:
        image: BGR (or grayscale) uint8 image.
    Returns:
        HxW bool mask, True on ink pixels.
    """
    gray = to_gray(image)
    h, w = gray.shape
    shrink = min(1.0, BACKGROUND_MAX_SIDE / max(h, w))
    small = gray if shrink == 1.0 else cv2.resize(gray, (max(1, round(w * shrink)), max(1, round(h * shrink))), interpolation=cv2.INTER_AREA)
    k = _odd(max(MIN_BACKGROUND_KERNEL, BACKGROUND_KERNEL_FRACTION * max(small.shape)))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    background = cv2.blur(cv2.morphologyEx(small, cv2.MORPH_CLOSE, kernel), (k, k))
    if shrink != 1.0:
        background = cv2.resize(background, (w, h), interpolation=cv2.INTER_LINEAR)
    ratio = gray / np.maximum(background, 1.0)
    return ratio < INK_RATIO


def stroke_width(mask: np.ndarray) -> float:
    """
    Typical stroke width from the median distance-to-background d along stroke centre lines (2d - 1, since the
    centre pixel itself counts once).

    Centre lines are the ridge pixels of the distance transform (local maxima), so filled shapes
    such as junction dots and arrow heads contribute only a few pixels and do not skew the estimate.

    Args:
        mask: Bool ink mask.
    Returns:
        Stroke width in pixels (at least 1.0).
    """
    if not mask.any():
        return 1.0
    dist = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    ridge = (dist > 0) & (dist >= cv2.dilate(dist, np.ones((3, 3), np.uint8)))
    values = dist[ridge] if ridge.any() else dist[dist > 0]
    return max(1.0, float(2.0 * np.median(values) - 1.0))
