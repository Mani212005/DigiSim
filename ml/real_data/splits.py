"""
Module: splits.py
Purpose: Split bookkeeping for the real-data set: one ImageRecord per image, the hashes that freeze the
         eval splits, and the leakage verifier. A "group" is the unit that must never straddle splits: a CGHD
         drafter (each drafter drew every circuit in 2 drawings x 4 photos, so image-level splits leak) or a
         single source image for the Roboflow and Sampleimages data.
"""

import hashlib
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

# Two images whose 256-bit difference hashes differ in at most this many bits count as near-duplicates.
NEAR_DUPLICATE_BITS = 24
HASH_SIZE = 16
# Working resolution and blur radius used to flatten lighting before hashing.
_WORK_SIZE = 256
_FLATTEN_RADIUS = 10


@dataclass(frozen=True)
class ImageRecord:
    """
    Everything the manifest stores about one image.

    `sha256` is the hash of the upstream (original) file, which is stable; the converted copy in the YOLO
    directory is byte-identical unless `exif_baked` is true, in which case the EXIF orientation was applied
    and removed so that every loader sees the frame the annotations were drawn in.
    """

    name: str
    split: str
    source: str
    group: str
    source_id: str
    sha256: str
    label_sha256: str
    dhash: str
    width: int
    height: int
    exif_baked: bool = False
    class_counts: dict[str, int] = field(default_factory=dict)
    ignored_counts: dict[str, int] = field(default_factory=dict)


def sha256_file(path: Path) -> str:
    """
    SHA-256 of a file's bytes.

    Args:
        path: File to hash.
    Returns:
        Lower-case hex digest.
    """
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def dhash(path: Path, size: int = HASH_SIZE) -> str:
    """
    Difference hash of an image, robust to resizing, re-encoding and uneven lighting.

    Photographs of pages are dominated by lighting gradients, which would make every page look alike, so the
    image is divided by its own blur (local contrast normalisation) before the horizontal-gradient hash.

    Args:
        path: Image file.
        size: Hash grid size; the hash has size*size bits.
    Returns:
        Hex string of the hash (size*size/4 digits).
    """
    with Image.open(path) as im:
        im.draft("L", (_WORK_SIZE * 2, _WORK_SIZE * 2))
        gray = im.convert("L").resize((_WORK_SIZE, _WORK_SIZE), Image.Resampling.LANCZOS)
    flat = np.asarray(gray, dtype=np.float32) / (np.asarray(gray.filter(ImageFilter.GaussianBlur(_FLATTEN_RADIUS)), dtype=np.float32) + 1.0)
    small = np.asarray(Image.fromarray(flat).resize((size + 1, size), Image.Resampling.BOX), dtype=np.float32)
    bits = (small[:, 1:] > small[:, :-1]).flatten()
    return f"{int(''.join('1' if b else '0' for b in bits), 2):0{size * size // 4}x}"


def hamming(a: str, b: str) -> int:
    """
    Hamming distance between two hex hashes of equal length.

    Args:
        a: First hash.
        b: Second hash.
    Returns:
        Number of differing bits.
    """
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def split_hash(records: list[ImageRecord], split: str) -> str:
    """
    Content hash of one split: changes if any image, label or membership changes.

    Args:
        records: All image records.
        split: Split name.
    Returns:
        SHA-256 hex digest over the sorted "name image_sha label_sha" lines of that split.
    """
    lines = sorted(f"{r.name} {r.sha256} {r.label_sha256}" for r in records if r.split == split)
    return hashlib.sha256("\n".join(lines).encode()).hexdigest()


def verify_no_leakage(records: list[ImageRecord]) -> list[str]:
    """
    Check that no group, source image or image content appears in two splits.

    Args:
        records: All image records.
    Returns:
        Human-readable violations; empty when the splits are clean. Checks: a group (drafter or source
        image) lives in exactly one split; a source id lives in exactly one split; a byte-identical image
        lives in exactly one split; no pair of images in different splits is a near-duplicate.
    """
    problems: list[str] = []
    for key, label in (("group", "group"), ("source_id", "source image"), ("sha256", "identical image content")):
        seen: dict[str, str] = {}
        for rec in records:
            value = getattr(rec, key)
            first = seen.setdefault(value, rec.split)
            if first != rec.split:
                problems.append(f"{label} {value} appears in splits {first} and {rec.split}")
    by_split: dict[str, list[ImageRecord]] = {}
    for rec in records:
        by_split.setdefault(rec.split, []).append(rec)
    splits = sorted(by_split)
    for i, left in enumerate(splits):
        for right in splits[i + 1 :]:
            for a in by_split[left]:
                for b in by_split[right]:
                    if hamming(a.dhash, b.dhash) <= NEAR_DUPLICATE_BITS:
                        problems.append(f"near-duplicate images {a.name} ({left}) and {b.name} ({right})")
    return sorted(set(problems))
