"""
Module: make_smoke_dataset.py
Purpose: Generates a tiny throwaway YOLO dataset (procedural glyphs with exact boxes, class names from
         ml/classes.yaml) for exercising the training harness end to end on CPU or in CI. It is NOT
         training data for the real detector - the glyphs are crude and carry no circuit meaning; real
         data comes from the synthetic generator and the real-data ingestion tasks. Output stays out of git.

Usage:
    cd ml && uv run python make_smoke_dataset.py --out /tmp/digisim_smoke --count 200
"""

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

import cv2
import numpy as np

from class_schema import load_schema, render_data_yaml

IMAGE_SIZE = 320
SPLIT_FRACTIONS: tuple[tuple[str, float], ...] = (("train", 0.7), ("valid", 0.15), ("test", 0.15))


def draw_glyph(canvas: np.ndarray, class_id: int, center: tuple[int, int], size: int) -> tuple[int, int, int, int]:
    """
    Draw one crude class-specific glyph (polygon with class-dependent corner count, plus a stripe pattern).

    Args:
        canvas: BGR image to draw on (modified in place).
        class_id: YOLO class id; selects the glyph shape.
        center: Glyph centre in pixels.
        size: Glyph edge length in pixels.
    Returns:
        Pixel box (x1, y1, x2, y2) tightly enclosing the glyph, clipped to the canvas.
    """
    cx, cy = center
    half = size // 2
    sides = 3 + class_id % 6
    angles = np.linspace(0, 2 * np.pi, sides, endpoint=False) + (class_id % 4) * np.pi / 8
    pts = np.stack([cx + half * np.cos(angles), cy + half * np.sin(angles)], axis=1).astype(np.int32)
    shade = 30 + (class_id * 37) % 140
    cv2.polylines(canvas, [pts], True, (shade, shade, shade), 2)
    for k in range(class_id % 4):
        y = cy - half // 2 + k * (half // 2)
        cv2.line(canvas, (cx - half // 2, y), (cx + half // 2, y), (shade, shade, shade), 1)
    h, w = canvas.shape[:2]
    x1, y1 = np.clip(pts.min(axis=0) - 1, 0, [w - 1, h - 1])
    x2, y2 = np.clip(pts.max(axis=0) + 1, 0, [w - 1, h - 1])
    return int(x1), int(y1), int(x2), int(y2)


def make_image(rng: np.random.Generator, nc: int) -> tuple[np.ndarray, list[str]]:
    """
    Compose one image with 2-5 non-overlapping glyphs and their YOLO label lines.

    Args:
        rng: Seeded random generator.
        nc: Number of classes to draw from.
    Returns:
        (BGR image, label lines '<class> <cx> <cy> <w> <h>' normalised).
    """
    canvas = np.full((IMAGE_SIZE, IMAGE_SIZE, 3), 255, dtype=np.uint8)
    labels: list[str] = []
    taken: list[tuple[int, int, int, int]] = []
    for _ in range(int(rng.integers(2, 6))):
        size = int(rng.integers(36, 72))
        cx = int(rng.integers(size, IMAGE_SIZE - size))
        cy = int(rng.integers(size, IMAGE_SIZE - size))
        probe = (cx - size, cy - size, cx + size, cy + size)
        if any(probe[0] < t[2] and probe[2] > t[0] and probe[1] < t[3] and probe[3] > t[1] for t in taken):
            continue
        cls = int(rng.integers(0, nc))
        x1, y1, x2, y2 = draw_glyph(canvas, cls, (cx, cy), size)
        taken.append(probe)
        labels.append(f"{cls} {(x1 + x2) / 2 / IMAGE_SIZE:.6f} {(y1 + y2) / 2 / IMAGE_SIZE:.6f} {(x2 - x1) / IMAGE_SIZE:.6f} {(y2 - y1) / IMAGE_SIZE:.6f}")
    noise = rng.integers(-6, 7, canvas.shape, dtype=np.int16)
    return np.clip(canvas.astype(np.int16) + noise, 0, 255).astype(np.uint8), labels


def generate(out: Path, count: int, seed: int) -> Path:
    """
    Write a YOLO dataset (images/, labels/, data.yaml) with train/valid/test splits.

    Args:
        out: Output dataset root (created).
        count: Total number of images.
        seed: RNG seed (same seed gives identical files).
    Returns:
        Path to the generated data.yaml.
    Raises:
        ValueError: If count is too small to fill every split.
    """
    if count < len(SPLIT_FRACTIONS) * 2:
        raise ValueError("count must be at least 6 so every split has images")
    schema = load_schema()
    nc = len(schema.classes_up_to("A"))
    rng = np.random.default_rng(seed)
    n_valid = max(1, round(count * SPLIT_FRACTIONS[1][1]))
    n_test = max(1, round(count * SPLIT_FRACTIONS[2][1]))
    sizes = {"train": count - n_valid - n_test, "valid": n_valid, "test": n_test}
    for split, n in sizes.items():
        (out / "images" / split).mkdir(parents=True, exist_ok=True)
        (out / "labels" / split).mkdir(parents=True, exist_ok=True)
        for i in range(n):
            image, labels = make_image(rng, nc)
            cv2.imwrite(str(out / "images" / split / f"smoke_{split}_{i:04d}.jpg"), image)
            (out / "labels" / split / f"smoke_{split}_{i:04d}.txt").write_text("\n".join(labels) + ("\n" if labels else ""))
    data_yaml = out / "data.yaml"
    data_yaml.write_text(render_data_yaml(schema, out, "A"))
    return data_yaml


def main(argv: Sequence[str] | None = None) -> int:
    """
    CLI entry point.

    Args:
        argv: Argument list (defaults to sys.argv[1:]).
    Returns:
        Process exit code.
    """
    parser = argparse.ArgumentParser(description="Generate a tiny throwaway YOLO dataset for harness smoke tests")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--count", type=int, default=200)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args(argv)
    print(generate(args.out, args.count, args.seed))
    return 0


if __name__ == "__main__":
    sys.exit(main())
