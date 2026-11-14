"""
Module: detector.py
Purpose: YOLOv8 symbol detection stage — takes a circuit image and returns bounding boxes
         with class labels for all detected circuit symbols (transistors, supplies, ports,
         gates, junctions). Runs fully local inference with the transfer-learned weights
         produced by ml/train.py. The class vocabulary comes from ml/classes.yaml via the
         generated pipeline/class_map.py; legacy gate-era names stay resolvable as aliases.
"""

from dataclasses import dataclass
from pathlib import Path

from ultralytics import YOLO

from pipeline.class_map import CLASS_ALIASES, CLASS_NAMES, CLASS_TO_NODE_TYPE

__all__ = [
    "CLASS_ALIASES",
    "CLASS_NAMES",
    "CLASS_TO_NODE_TYPE",
    "Detection",
    "GateDetector",
    "resolve_class_name",
]


@dataclass
class Detection:
    """A single symbol detection result from the YOLO model."""

    class_name: str
    confidence: float
    x: float
    y: float
    width: float
    height: float

    @property
    def box(self) -> tuple[float, float, float, float]:
        """
        Corner-form bounding box.

        Returns:
            (x1, y1, x2, y2) in pixels, where (x, y) is the box centre.
        """
        return (
            self.x - self.width / 2,
            self.y - self.height / 2,
            self.x + self.width / 2,
            self.y + self.height / 2,
        )


def resolve_class_name(class_name: str) -> str | None:
    """
    Resolve a model class name (canonical or legacy alias, any case) to its canonical name.

    Args:
        class_name: Class name as emitted by a model, e.g. 'NMOS' or the legacy 'SWITCH'.
    Returns:
        The canonical class name, or None if the name is not in the vocabulary.
    """
    upper = class_name.strip().upper()
    if upper in CLASS_NAMES:
        return upper
    return CLASS_ALIASES.get(upper)


class GateDetector:
    """Runs local YOLOv8 inference to detect logic gates in a circuit image."""

    def __init__(self, weights_path: Path, confidence_threshold: float = 0.5) -> None:
        """
        Initialise the detector.

        Args:
            weights_path: Path to trained YOLOv8 .pt weights file.
            confidence_threshold: Minimum confidence to include a detection.
        Raises:
            FileNotFoundError: If the weights file does not exist.
        """
        if not weights_path.exists():
            raise FileNotFoundError(f"Model weights not found: {weights_path}")
        self.weights_path = weights_path
        self.confidence_threshold = confidence_threshold
        self._model = YOLO(str(weights_path))

    def detect(self, image_path: Path) -> list[Detection]:
        """
        Run inference on a circuit image and return all gate detections.

        Args:
            image_path: Path to the input circuit image.
        Returns:
            List of Detection objects, one per detected gate.
        Raises:
            FileNotFoundError: If image_path does not exist.
        """
        if not image_path.exists():
            raise FileNotFoundError(f"Image not found: {image_path}")

        results = self._model.predict(
            source=str(image_path),
            conf=self.confidence_threshold,
            device="cpu",
            verbose=False,
        )

        detections: list[Detection] = []
        for result in results:
            names = result.names
            for box in result.boxes:
                cx, cy, w, h = (float(v) for v in box.xywh[0])
                detections.append(
                    Detection(
                        class_name=names[int(box.cls[0])],
                        confidence=float(box.conf[0]),
                        x=cx,
                        y=cy,
                        width=w,
                        height=h,
                    )
                )
        return detections
