"""
Module: augmentation.py
Purpose: Offline augmentation for YOLO-labelled gate images. Applies photometric
         and mild geometric transforms (brightness, blur, noise, shadow bands,
         rotation, perspective) and rewrites bounding boxes accordingly. Used to
         multiply the scarce hand-drawn images without re-annotating.

Usage:
    cd backend && uv run python data_gen/augmentation.py \
        --dataset ../ml/dataset --split train --variants 2 --match rf_
"""

import argparse
from pathlib import Path

import cv2
import numpy as np


def _read_labels(path: Path) -> list[tuple[int, float, float, float, float]]:
    """
    Read a YOLO label file.

    Args:
        path: Label .txt path.
    Returns:
        List of (class_id, cx, cy, w, h) normalised tuples.
    """
    rows = []
    for line in path.read_text().splitlines():
        parts = line.split()
        if len(parts) >= 5:
            rows.append(
                (
                    int(parts[0]),
                    float(parts[1]),
                    float(parts[2]),
                    float(parts[3]),
                    float(parts[4]),
                )
            )
    return rows


def _boxes_to_corners(
    rows: list[tuple[int, float, float, float, float]], w: int, h: int
) -> tuple[list[int], np.ndarray]:
    """
    Convert normalised YOLO boxes to pixel-space corner points.

    Args:
        rows: YOLO label rows.
        w: Image width.
        h: Image height.
    Returns:
        Tuple of (class ids, Nx4x2 array of box corner points).
    """
    ids, corners = [], []
    for cls_id, cx, cy, bw, bh in rows:
        x1, y1 = (cx - bw / 2) * w, (cy - bh / 2) * h
        x2, y2 = (cx + bw / 2) * w, (cy + bh / 2) * h
        ids.append(cls_id)
        corners.append([[x1, y1], [x2, y1], [x2, y2], [x1, y2]])
    return ids, np.array(corners, dtype=np.float64).reshape(-1, 4, 2)


def _corners_to_yolo(ids: list[int], corners: np.ndarray, w: int, h: int) -> list[str]:
    """
    Convert transformed corner points back to clipped YOLO label lines.

    Args:
        ids: Class ids matching corners.
        corners: Nx4x2 transformed corner points.
        w: Image width.
        h: Image height.
    Returns:
        YOLO label lines.
    """
    lines = []
    for cls_id, quad in zip(ids, corners):
        x1 = float(np.clip(quad[:, 0].min(), 0, w))
        x2 = float(np.clip(quad[:, 0].max(), 0, w))
        y1 = float(np.clip(quad[:, 1].min(), 0, h))
        y2 = float(np.clip(quad[:, 1].max(), 0, h))
        if x2 - x1 < 4 or y2 - y1 < 4:
            continue
        lines.append(
            f"{cls_id} {(x1 + x2) / 2 / w:.6f} {(y1 + y2) / 2 / h:.6f} "
            f"{(x2 - x1) / w:.6f} {(y2 - y1) / h:.6f}"
        )
    return lines


def augment_once(
    img: np.ndarray, corners: np.ndarray, rng: np.random.Generator
) -> tuple[np.ndarray, np.ndarray]:
    """
    Apply one random augmentation chain to an image and its box corners.

    Args:
        img: BGR image.
        corners: Nx4x2 box corner points.
        rng: Random generator.
    Returns:
        Tuple of (augmented image, transformed corners).
    """
    h, w = img.shape[:2]

    # Mild rotation about the centre.
    angle = rng.uniform(-6, 6)
    mat = cv2.getRotationMatrix2D((w / 2, h / 2), angle, rng.uniform(0.92, 1.05))
    img = cv2.warpAffine(img, mat, (w, h), borderMode=cv2.BORDER_REPLICATE)
    if len(corners):
        ones = np.ones((*corners.shape[:2], 1))
        corners = np.concatenate([corners, ones], axis=2) @ mat.T

    # Brightness / contrast.
    alpha = rng.uniform(0.75, 1.25)
    beta = rng.uniform(-25, 25)
    img = np.clip(img.astype(np.float64) * alpha + beta, 0, 255).astype(np.uint8)

    # Shadow band across the page (common in phone photos).
    if rng.random() < 0.5:
        mask = np.zeros((h, w), dtype=np.float64)
        x0 = int(rng.uniform(0, w))
        width = int(rng.uniform(w * 0.2, w * 0.6))
        mask[:, max(0, x0 - width) : x0] = rng.uniform(15, 45)
        img = np.clip(img.astype(np.float64) - mask[..., None], 0, 255).astype(np.uint8)

    # Blur and sensor noise.
    if rng.random() < 0.5:
        k = int(rng.choice([3, 5]))
        img = cv2.GaussianBlur(img, (k, k), 0)
    img = np.clip(
        img.astype(np.float64) + rng.normal(0, rng.uniform(2, 7), img.shape),
        0,
        255,
    ).astype(np.uint8)

    return img, corners


def augment_split(
    dataset: Path, split: str, variants: int, match: str, seed: int
) -> int:
    """
    Generate augmented copies of every matching image in a dataset split.

    Args:
        dataset: Dataset root containing images/<split> and labels/<split>.
        split: Split name ('train', 'valid', 'test').
        variants: Augmented copies to create per source image.
        match: Only augment images whose filename starts with this prefix
               (empty string matches everything).
        seed: RNG seed.
    Returns:
        Number of augmented images written.
    Raises:
        FileNotFoundError: If the split directories do not exist.
    """
    img_dir = dataset / "images" / split
    lbl_dir = dataset / "labels" / split
    if not img_dir.is_dir() or not lbl_dir.is_dir():
        raise FileNotFoundError(f"Split directories missing under {dataset}")

    rng = np.random.default_rng(seed)
    written = 0
    for img_path in sorted(img_dir.iterdir()):
        if img_path.name.startswith("aug_") or not img_path.stem.startswith(match):
            continue
        lbl_path = lbl_dir / (img_path.stem + ".txt")
        if not lbl_path.exists():
            continue
        img = cv2.imread(str(img_path))
        if img is None:
            continue
        rows = _read_labels(lbl_path)
        ids, corners = _boxes_to_corners(rows, img.shape[1], img.shape[0])
        for v in range(variants):
            aug_img, aug_corners = augment_once(img.copy(), corners.copy(), rng)
            name = f"aug_{img_path.stem}_{v}"
            cv2.imwrite(str(img_dir / f"{name}.jpg"), aug_img)
            lines = _corners_to_yolo(
                ids, aug_corners, aug_img.shape[1], aug_img.shape[0]
            )
            (lbl_dir / f"{name}.txt").write_text("\n".join(lines) + "\n")
            written += 1
    return written


def main() -> None:
    """
    CLI entry point.

    Raises:
        SystemExit: On argparse errors.
    """
    parser = argparse.ArgumentParser(description="Offline YOLO augmentation")
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--split", default="train")
    parser.add_argument("--variants", type=int, default=2)
    parser.add_argument("--match", default="", help="filename prefix filter (e.g. rf_)")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    n = augment_split(args.dataset, args.split, args.variants, args.match, args.seed)
    print(f"wrote {n} augmented images to {args.dataset}/images/{args.split}")


if __name__ == "__main__":
    main()
