"""
Module: detector.py
Purpose: YOLOv8 gate detection stage — takes a circuit image and returns bounding boxes
         with class labels for all detected logic gates.
"""

from dataclasses import dataclass
from pathlib import Path


@dataclass
class Detection:
    """A single gate detection result from the YOLO model."""

    class_name: str
    confidence: float
    x: float
    y: float
    width: float
    height: float


CLASS_TO_NODE_TYPE: dict[str, str] = {
    "and gate": "andGate",
    "or gate": "orGate",
    "not gate": "notGate",
    "nand gate": "nandGate",
    "nor gate": "norGate",
    "xor gate": "xorGate",
    "xnor gate": "xnorGate",
    "switch": "switch",
    "input": "input",
    "output": "output",
    "led": "led",
    "junction": "junction",
}


class GateDetector:
    """Runs local YOLOv8 inference to detect logic gates in a circuit image."""

    def __init__(self, weights_path: Path, confidence_threshold: float = 0.5) -> None:
        """
        Initialise the detector.

        Args:
            weights_path: Path to trained YOLOv8 .pt weights file.
            confidence_threshold: Minimum confidence to include a detection.
        """
        self.weights_path = weights_path
        self.confidence_threshold = confidence_threshold

    def detect(self, image_path: Path) -> list[Detection]:
        """
        Run inference on a circuit image and return all gate detections.

        Args:
            image_path: Path to the input circuit image.
        Returns:
            List of Detection objects, one per detected gate.
        Raises:
            NotImplementedError: Until Phase 1 training is complete and weights exist.
            FileNotFoundError: If image_path does not exist.
        """
        if not image_path.exists():
            raise FileNotFoundError(f"Image not found: {image_path}")
        raise NotImplementedError(
            "Model weights not yet available. Train Phase 1 first."
        )
