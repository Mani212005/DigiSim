"""
Module: embedder.py
Purpose: Visual identity embeddings for open-set component recognition. Wraps a
         DINOv2-S (ViT-S/14) backbone loaded through torch.hub and produces
         L2-normalised 384-d vectors from component reference images and crops.
         CPU-only inference; weights download once into the torch hub cache and
         are never committed to git. No training happens here — "learning" a new
         component is a forward pass (enrollment), not a gradient step.
"""

from pathlib import Path

import cv2
import numpy as np
import torch

EMBEDDING_DIM = 384
_INPUT_SIZE = 224
_IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


class ComponentEmbedder:
    """Produces identity embeddings for component images (DINOv2-S, CPU)."""

    def __init__(self) -> None:
        """
        Load the DINOv2-S backbone from the torch hub cache (downloads on first use).

        Raises:
            RuntimeError: When the backbone cannot be loaded (e.g. offline with a
                cold cache) — callers should degrade gracefully, not crash.
        """
        try:
            self._model = torch.hub.load(
                "facebookresearch/dinov2", "dinov2_vits14", trust_repo=True
            )
        except (OSError, RuntimeError, ValueError, ImportError) as exc:
            raise RuntimeError(f"DINOv2 backbone unavailable: {exc}") from exc
        self._model.eval()

    def _preprocess(self, image_bgr: np.ndarray) -> torch.Tensor:
        """
        Resize the shorter side to the model input size, centre-crop, and
        normalise to ImageNet statistics.

        Args:
            image_bgr: OpenCV BGR image of any size.
        Returns:
            (1, 3, 224, 224) float tensor ready for the backbone.
        """
        height, width = image_bgr.shape[:2]
        scale = _INPUT_SIZE / min(height, width)
        new_w = max(_INPUT_SIZE, round(width * scale))
        new_h = max(_INPUT_SIZE, round(height * scale))
        resized = cv2.resize(image_bgr, (new_w, new_h), interpolation=cv2.INTER_AREA)

        top = (new_h - _INPUT_SIZE) // 2
        left = (new_w - _INPUT_SIZE) // 2
        crop = resized[top : top + _INPUT_SIZE, left : left + _INPUT_SIZE]

        rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        rgb = (rgb - _IMAGENET_MEAN) / _IMAGENET_STD
        return torch.from_numpy(rgb.transpose(2, 0, 1)).unsqueeze(0)

    @torch.inference_mode()
    def embed_bgr(self, image_bgr: np.ndarray) -> np.ndarray:
        """
        Embed one OpenCV BGR image.

        Args:
            image_bgr: Component reference image or detection crop.
        Returns:
            L2-normalised float32 vector of shape (EMBEDDING_DIM,).
        """
        features = self._model(self._preprocess(image_bgr))
        vector = features[0].cpu().numpy().astype(np.float32)
        norm = float(np.linalg.norm(vector))
        return vector / norm if norm > 0 else vector

    def embed_path(self, image_path: Path) -> np.ndarray:
        """
        Embed an image file from disk.

        Args:
            image_path: Path to a decodable image file.
        Returns:
            L2-normalised float32 vector of shape (EMBEDDING_DIM,).
        Raises:
            ValueError: When the file cannot be decoded as an image.
        """
        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError(f"Could not decode image: {image_path}")
        return self.embed_bgr(image)


_embedder: ComponentEmbedder | None = None
_embedder_error: str | None = None


def get_embedder() -> ComponentEmbedder | None:
    """
    Lazily construct the process-wide shared embedder.

    Returns:
        The cached ComponentEmbedder, or None when the backbone can't be loaded
        (offline cold cache) — enrollment then stores images without embeddings
        and a later pass can backfill them.
    """
    global _embedder, _embedder_error
    if _embedder is None and _embedder_error is None:
        try:
            _embedder = ComponentEmbedder()
        except RuntimeError as exc:
            _embedder_error = str(exc)
    return _embedder


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """
    Cosine similarity of two already L2-normalised vectors.

    Args:
        a: Normalised embedding.
        b: Normalised embedding.
    Returns:
        Similarity in [-1, 1] (dot product of unit vectors).
    """
    return float(np.dot(a, b))
