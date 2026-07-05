"""
Module: ocr_reader.py
Purpose: Silkscreen/part-number OCR for component crops — a strong identity
         disambiguator (e.g. ESP32 vs ESP32-S3 both look like dev boards, but
         their silkscreen says which). Wraps RapidOCR (ONNX, CPU) behind a lazy
         singleton with graceful degradation when the models can't load.
"""

import cv2
import numpy as np

_MIN_TEXT_CONFIDENCE = 0.5

_ocr = None
_ocr_error: str | None = None


def _get_ocr():
    """
    Lazily construct the shared RapidOCR engine.

    Returns:
        The cached RapidOCR instance, or None when it cannot be initialised
        (missing models / unsupported platform) — callers skip the OCR signal.
    """
    global _ocr, _ocr_error
    if _ocr is None and _ocr_error is None:
        try:
            from rapidocr_onnxruntime import RapidOCR

            _ocr = RapidOCR()
        except (ImportError, OSError, RuntimeError, ValueError) as exc:
            _ocr_error = str(exc)
    return _ocr


def read_text(image_bgr: np.ndarray) -> list[str]:
    """
    Extract confident text fragments from a component crop.

    Args:
        image_bgr: OpenCV BGR crop of one detected component.
    Returns:
        Lowercased text fragments with confidence ≥ 0.5; empty when OCR is
        unavailable or nothing is legible.
    """
    ocr = _get_ocr()
    if ocr is None:
        return []
    try:
        result, _elapsed = ocr(image_bgr)
    except (RuntimeError, ValueError, cv2.error):
        return []
    if not result:
        return []
    return [
        str(text).strip().lower()
        for _box, text, confidence in result
        if float(confidence) >= _MIN_TEXT_CONFIDENCE and str(text).strip()
    ]
