"""
Module: build_dataset.py
Purpose: Assemble the self-contained training dataset for the stage-A / stage-B detector runs (Kaggle or
         local) from the two data sources on disk: the synthetic generator v2 output
         (backend/data_gen/generate_v2.py) and the converted real data (ml/data_real/yolo, built by
         `python -m real_data.build convert`). The output folder is what gets uploaded as one private
         Kaggle dataset, so every path inside it is relative.

         What it does to the real data (training copies only, the frozen eval set is never touched):
           - keeps tier A labels only (ml/classes.yaml ids are shared, so tier B lines are dropped and
             those objects become background, which is correct for a tier A detector);
           - downsizes images to at most --real-max-side pixels (labels are normalised, so unchanged);
           - paints out `uncertain_*` ignore regions in train/valid (objects T4 could not label: transistors
             of undecided polarity, terminals of undecided role, supplies of undecided sign), so the
             detector is not taught that a real transistor or port is background. Pixels inside labelled
             boxes are never painted.

         Layout written under --out:
           synth/{images,labels}/{train,valid,test}/      synthetic samples (file names prefixed syn_)
           real/{images,labels}/{train,valid,test}/       real samples (tier A labels)
           stage_a.yaml   synthetic train / valid / test
           stage_b.yaml   train = stage_b_synth_train.txt (a synthetic subset; real images are added and
                          oversampled by the trainer's --real-train real/images/train), val = synthetic
                          valid + real valid, test = real test
           train_kaggle.py, t7_session.py   the trainer and the session driver, so the kernel needs no repo
           build_info.json  counts, settings and source hashes of this build
Usage:
    cd ml && uv run python kaggle/build_dataset.py --synth DIR --real data_real/yolo --out OUT
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from collections import Counter
from pathlib import Path

import cv2
import numpy as np
import yaml

ML_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ML_DIR))

from class_schema import load_schema  # noqa: E402

SPLITS = ("train", "valid", "test")
PAINT_REASONS = ("uncertain_fet", "uncertain_supply", "uncertain_terminal")
PAINT_SPLITS = ("train", "valid")
DEFAULT_REAL_MAX_SIDE = 1920
DEFAULT_STAGE_B_SYNTH = 2500
RING_PX = 6
LABEL_MARGIN_PX = 2
JPEG_QUALITY = 92
SEED = 0


def link_or_copy(src: Path, dst: Path) -> None:
    """
    Hard-link a file (fast, no extra disk) and fall back to a copy across file systems.

    Args:
        src: Existing file.
        dst: Destination path (parent created).
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def tier_a_lines(label_text: str, n_tier_a: int) -> list[str]:
    """
    Keep the YOLO label lines whose class id is a tier A class.

    Args:
        label_text: Contents of a YOLO label file.
        n_tier_a: Number of tier A classes (ids 0..n-1 in ml/classes.yaml order).
    Returns:
        The kept lines (without trailing newlines).
    Raises:
        ValueError: If a line does not start with an integer class id.
    """
    kept: list[str] = []
    for line in label_text.splitlines():
        parts = line.split()
        if not parts:
            continue
        if int(parts[0]) < n_tier_a:
            kept.append(" ".join(parts))
    return kept


def label_boxes_px(lines: list[str], width: int, height: int) -> list[tuple[int, int, int, int]]:
    """
    Pixel xyxy boxes of YOLO box lines (polygon lines use their bounding box).

    Args:
        lines: YOLO label lines.
        width: Image width in pixels.
        height: Image height in pixels.
    Returns:
        Integer xyxy boxes.
    """
    boxes: list[tuple[int, int, int, int]] = []
    for line in lines:
        vals = [float(v) for v in line.split()[1:]]
        if len(vals) == 4:
            cx, cy, w, h = vals
            x1, y1, x2, y2 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
        else:
            xs, ys = vals[0::2], vals[1::2]
            x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
        boxes.append((int(x1 * width), int(y1 * height), int(np.ceil(x2 * width)), int(np.ceil(y2 * height))))
    return boxes


def paint_regions(image: np.ndarray, regions: list[list[float]], keep: list[tuple[int, int, int, int]]) -> int:
    """
    Fill ignore regions with the surrounding paper colour, never touching labelled boxes.

    Args:
        image: BGR image, modified in place.
        regions: Pixel xyxy boxes to paint.
        keep: Pixel xyxy boxes of labelled objects (protected, with a small margin).
    Returns:
        Number of regions painted.
    """
    height, width = image.shape[:2]
    protect = np.zeros((height, width), dtype=bool)
    for x1, y1, x2, y2 in keep:
        protect[max(0, y1 - LABEL_MARGIN_PX) : min(height, y2 + LABEL_MARGIN_PX), max(0, x1 - LABEL_MARGIN_PX) : min(width, x2 + LABEL_MARGIN_PX)] = True
    painted = 0
    for box in regions:
        x1, y1 = max(0, int(box[0])), max(0, int(box[1]))
        x2, y2 = min(width, int(np.ceil(box[2]))), min(height, int(np.ceil(box[3])))
        if x2 <= x1 or y2 <= y1:
            continue
        rx1, ry1, rx2, ry2 = max(0, x1 - RING_PX), max(0, y1 - RING_PX), min(width, x2 + RING_PX), min(height, y2 + RING_PX)
        ring = np.ones((ry2 - ry1, rx2 - rx1), dtype=bool)
        ring[y1 - ry1 : y2 - ry1, x1 - rx1 : x2 - rx1] = False
        ring_pixels = image[ry1:ry2, rx1:rx2][ring]
        if len(ring_pixels) == 0:
            continue
        # The brightest half of the ring is paper (ink is darker): its median is the fill colour.
        brightness = ring_pixels.astype(np.int32).sum(axis=1)
        paper = ring_pixels[brightness >= np.median(brightness)]
        fill = np.median(paper, axis=0).astype(np.uint8)
        mask = ~protect[y1:y2, x1:x2]
        if mask.any():
            image[y1:y2, x1:x2][mask] = fill
            painted += 1
    return painted


def build_real(real_root: Path, out: Path, n_tier_a: int, max_side: int) -> dict[str, object]:
    """
    Write the real-data part: tier A labels, downsized images, uncertain regions painted in train/valid.

    Args:
        real_root: ml/data_real/yolo (images/, labels/, ignore/ per split).
        out: Output dataset root.
        n_tier_a: Number of tier A classes.
        max_side: Longest image side after downsizing.
    Returns:
        Per-split image counts, tier A instance counts and painted-region counts.
    Raises:
        FileNotFoundError: If a split's images directory is missing.
    """
    stats: dict[str, object] = {}
    for split in SPLITS:
        src_images = real_root / "images" / split
        if not src_images.is_dir():
            raise FileNotFoundError(f"missing real split {src_images}")
        counts: Counter[int] = Counter()
        painted = 0
        images = sorted(p for p in src_images.iterdir() if p.is_file())
        for path in images:
            label_src = real_root / "labels" / split / f"{path.stem}.txt"
            lines = tier_a_lines(label_src.read_text() if label_src.exists() else "", n_tier_a)
            counts.update(int(line.split()[0]) for line in lines)
            image = cv2.imread(str(path), cv2.IMREAD_COLOR)
            if image is None:
                raise FileNotFoundError(f"unreadable image {path}")
            if split in PAINT_SPLITS:
                ignore_file = real_root / "ignore" / split / f"{path.stem}.json"
                records = json.loads(ignore_file.read_text()) if ignore_file.exists() else []
                regions = [r["xyxy"] for r in records if r.get("reason") in PAINT_REASONS]
                if regions:
                    painted += paint_regions(image, regions, label_boxes_px(lines, image.shape[1], image.shape[0]))
            scale = max_side / max(image.shape[:2])
            if scale < 1.0:
                image = cv2.resize(image, (round(image.shape[1] * scale), round(image.shape[0] * scale)), interpolation=cv2.INTER_AREA)
            dst = out / "real" / "images" / split / f"{path.stem}.jpg"
            dst.parent.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(dst), image, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
            label_dst = out / "real" / "labels" / split / f"{path.stem}.txt"
            label_dst.parent.mkdir(parents=True, exist_ok=True)
            label_dst.write_text("".join(f"{line}\n" for line in lines))
        stats[split] = {"images": len(images), "instances": dict(sorted(counts.items())), "painted_regions": painted}
    return stats


def build_synth(synth_root: Path, out: Path) -> dict[str, int]:
    """
    Link the synthetic images and labels in, prefixing file names with `syn_` (the evaluator's domain rule).

    Args:
        synth_root: generate_v2.py output folder.
        out: Output dataset root.
    Returns:
        Images per split.
    Raises:
        FileNotFoundError: If a split's images directory is missing.
    """
    counts: dict[str, int] = {}
    for split in SPLITS:
        src_images = synth_root / "images" / split
        if not src_images.is_dir():
            raise FileNotFoundError(f"missing synthetic split {src_images}")
        images = sorted(src_images.glob("*.jpg"))
        for path in images:
            link_or_copy(path, out / "synth" / "images" / split / f"syn_{path.name}")
            link_or_copy(synth_root / "labels" / split / f"{path.stem}.txt", out / "synth" / "labels" / split / f"syn_{path.stem}.txt")
        counts[split] = len(images)
    return counts


def write_yamls(out: Path, names: tuple[str, ...], stage_b_synth: int) -> int:
    """
    Write stage_a.yaml, stage_b.yaml and the stage-B synthetic subset list.

    Args:
        out: Output dataset root.
        names: Tier A class names in id order.
        stage_b_synth: Synthetic training images kept for stage B (a seeded random subset).
    Returns:
        Number of synthetic images in the stage-B list.
    """
    synth_train = sorted((out / "synth" / "images" / "train").glob("*.jpg"))
    rng = np.random.default_rng(SEED)
    keep = sorted(rng.choice(len(synth_train), size=min(stage_b_synth, len(synth_train)), replace=False).tolist())
    (out / "stage_b_synth_train.txt").write_text("".join(f"./synth/images/train/{synth_train[i].name}\n" for i in keep))
    # No `path:` key: ultralytics then resolves the splits against the yaml's own folder, wherever the dataset lives
    # (a relative `path: .` would resolve against its global datasets dir instead).
    common = {"nc": len(names), "names": list(names)}
    stage_a = {"train": "synth/images/train", "val": "synth/images/valid", "test": "synth/images/test", **common}
    stage_b = {"train": "stage_b_synth_train.txt", "val": ["synth/images/valid", "real/images/valid"], "test": "real/images/test", **common}
    (out / "stage_a.yaml").write_text(yaml.safe_dump(stage_a, sort_keys=False))
    (out / "stage_b.yaml").write_text(yaml.safe_dump(stage_b, sort_keys=False))
    return len(keep)


def manifest_sha256(path: Path) -> str | None:
    """
    SHA-256 of a source manifest file, recorded so a build can be traced back to its inputs.

    Args:
        path: Manifest file (may not exist).
    Returns:
        Hex digest, or None when the file is missing.
    """
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def build(synth_root: Path, real_root: Path, out: Path, real_max_side: int, stage_b_synth: int) -> dict[str, object]:
    """
    Build the whole dataset folder.

    Args:
        synth_root: generate_v2.py output folder.
        real_root: ml/data_real/yolo.
        out: Output folder (must not exist yet).
        real_max_side: Longest side of the real training copies.
        stage_b_synth: Synthetic images kept in the stage-B training list.
    Returns:
        The build_info.json contents.
    Raises:
        FileExistsError: If the output folder already exists.
    """
    if out.exists():
        raise FileExistsError(f"{out} exists; pick a new --out")
    names = tuple(c.name for c in load_schema().classes_up_to("A"))
    out.mkdir(parents=True)
    synth_counts = build_synth(synth_root, out)
    real_stats = build_real(real_root, out, len(names), real_max_side)
    stage_b_n = write_yamls(out, names, stage_b_synth)
    here = Path(__file__).resolve().parent
    for script in ("train_kaggle.py", "t7_session.py"):
        shutil.copy2(here / script, out / script)
    info: dict[str, object] = {
        "classes": list(names),
        "synthetic": {"source": str(synth_root), "manifest_sha256": manifest_sha256(synth_root / "manifest.json"), "images": synth_counts},
        "real": {"source": str(real_root), "max_side": real_max_side, "painted_reasons": list(PAINT_REASONS), "splits": real_stats},
        "stage_b_synthetic_train_images": stage_b_n,
    }
    (out / "build_info.json").write_text(json.dumps(info, indent=2) + "\n")
    return info


def main(argv: list[str] | None = None) -> int:
    """
    CLI entry point.

    Args:
        argv: Argument list (defaults to sys.argv[1:]).
    Returns:
        Process exit code (0 on success).
    """
    p = argparse.ArgumentParser(description="Assemble the stage-A/B training dataset folder (synthetic + real)")
    p.add_argument("--synth", type=Path, required=True, help="generate_v2.py output folder")
    p.add_argument("--real", type=Path, default=ML_DIR / "data_real" / "yolo", help="converted real data (python -m real_data.build convert)")
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--real-max-side", type=int, default=DEFAULT_REAL_MAX_SIDE)
    p.add_argument("--stage-b-synth", type=int, default=DEFAULT_STAGE_B_SYNTH, help="synthetic training images kept for stage B")
    args = p.parse_args(argv)
    info = build(args.synth, args.real, args.out, args.real_max_side, args.stage_b_synth)
    print(json.dumps(info, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
