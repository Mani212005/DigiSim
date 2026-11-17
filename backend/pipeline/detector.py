"""
Module: detector.py
Purpose: YOLOv8 symbol detection stage — takes a circuit image and returns bounding boxes
         with class labels for all detected circuit symbols (transistors, supplies, ports,
         gates, junctions). Runs fully local inference with the transfer-learned weights
         produced by ml/train.py. The class vocabulary comes from ml/classes.yaml via the
         generated pipeline/class_map.py; legacy gate-era names stay resolvable as aliases.

Detector -> tracer contract (pipeline/net_tracer.py):
    Each Detection carries its class name, confidence and box. Optionally it carries per-terminal
    pin points (`keypoints`): a pose/keypoint model (T7) predicts keypoint i of a detection as the
    point of terminal i of its class, in the terminal order of ml/classes.yaml (CLASS_TERMINALS);
    keypoints with visibility < KEYPOINT_MIN_VISIBILITY are dropped. Without keypoints the tracer
    falls back to its classical geometry pin assignment.
"""

from dataclasses import dataclass
from pathlib import Path

from pipeline.class_map import CLASS_ALIASES, CLASS_NAMES, CLASS_TERMINALS, CLASS_TO_NODE_TYPE

__all__ = [
    "CLASS_ALIASES",
    "CLASS_NAMES",
    "CLASS_TERMINALS",
    "CLASS_TO_NODE_TYPE",
    "Detection",
    "GateDetector",
    "canonical_class",
]

KEYPOINT_MIN_VISIBILITY = 0.5


def canonical_class(name: str) -> str:
    """
    Resolve a detector class name (canonical or legacy alias, any case) to its canonical name.

    Args:
        name: Class name as predicted by the weights.
    Returns:
        Canonical class name (unchanged when it is not a known alias).
    """
    upper = name.upper()
    return CLASS_ALIASES.get(upper, upper)


@dataclass
class Detection:
    """A single symbol detection result from the YOLO model."""

    class_name: str
    confidence: float
    x: float
    y: float
    width: float
    height: float
    # Terminal name -> pin point in image pixels, from a keypoint head (None when the model has none).
    keypoints: dict[str, tuple[float, float]] | None = None

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
        from ultralytics import YOLO  # deferred: torch is only needed when a model is actually loaded

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
            keypoints = getattr(result, "keypoints", None)
            for i, box in enumerate(result.boxes):
                cx, cy, w, h = (float(v) for v in box.xywh[0])
                class_name = names[int(box.cls[0])]
                detections.append(
                    Detection(
                        class_name=class_name,
                        confidence=float(box.conf[0]),
                        x=cx,
                        y=cy,
                        width=w,
                        height=h,
                        keypoints=_terminal_keypoints(class_name, keypoints, i),
                    )
                )
        return detections


def _terminal_keypoints(class_name: str, keypoints: object, index: int) -> dict[str, tuple[float, float]] | None:
    """
    Map a pose model's keypoints for one detection onto the class's terminal names.

    Args:
        class_name: Predicted class name.
        keypoints: ultralytics Keypoints object of the result (None for a plain detection model).
        index: Detection index inside the result.
    Returns:
        Terminal -> (x, y) for visible keypoints, or None when the model predicts no keypoints.
    """
    if keypoints is None:
        return None
    xy = keypoints.xy[index].tolist()
    conf = keypoints.conf[index].tolist() if keypoints.conf is not None else [1.0] * len(xy)
    terminals = CLASS_TERMINALS.get(canonical_class(class_name), ())
    points = {t: (float(p[0]), float(p[1])) for t, p, c in zip(terminals, xy, conf) if c >= KEYPOINT_MIN_VISIBILITY}
    return points or None
