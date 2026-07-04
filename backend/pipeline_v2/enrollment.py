"""
Module: enrollment.py
Purpose: Reference-image intake for the component library — decodes uploads,
         runs quality checks (size, blur, exposure), strips metadata by
         re-encoding, bounds the resolution, and stores the file on disk.
         Embedding and near-duplicate detection happen in library.py through
         pipeline_v2.embedder so this module stays torch-free and fast.
"""

from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import cv2
import numpy as np

MIN_SIDE = 96
MAX_SIDE = 1280
BLUR_WARN_THRESHOLD = 60.0
DARK_THRESHOLD = 30.0
BRIGHT_THRESHOLD = 225.0
JPEG_QUALITY = 90


@dataclass
class StoredImage:
    """A stored, quality-checked reference image."""

    path: Path
    quality: dict


def enroll_image(data: bytes, dest_dir: Path) -> StoredImage:
    """
    Validate, quality-check, and store one uploaded reference image.

    Re-encoding to JPEG drops EXIF metadata (GPS etc.) before anything is
    shared to the community library.

    Args:
        data: Raw uploaded file bytes.
        dest_dir: Directory to store the processed image in (created if needed).
    Returns:
        StoredImage with the saved path and a quality report:
        {width, height, blur_score, brightness, warnings: [...]}.
    Raises:
        ValueError: When the bytes are not a decodable image or the image is
            smaller than MIN_SIDE on its shorter side.
    """
    array = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Could not decode the uploaded file as an image")

    height, width = image.shape[:2]
    if min(height, width) < MIN_SIDE:
        raise ValueError(f"Image too small — the shorter side must be ≥ {MIN_SIDE}px")

    warnings: list[str] = []
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    if blur_score < BLUR_WARN_THRESHOLD:
        warnings.append("blurry")
    brightness = float(gray.mean())
    if brightness < DARK_THRESHOLD:
        warnings.append("too_dark")
    elif brightness > BRIGHT_THRESHOLD:
        warnings.append("too_bright")

    if max(height, width) > MAX_SIDE:
        scale = MAX_SIDE / max(height, width)
        image = cv2.resize(
            image,
            (round(width * scale), round(height * scale)),
            interpolation=cv2.INTER_AREA,
        )

    dest_dir.mkdir(parents=True, exist_ok=True)
    path = dest_dir / f"{uuid4().hex}.jpg"
    cv2.imwrite(str(path), image, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])

    quality = {
        "width": image.shape[1],
        "height": image.shape[0],
        "blur_score": round(blur_score, 1),
        "brightness": round(brightness, 1),
        "warnings": warnings,
    }
    return StoredImage(path=path, quality=quality)
