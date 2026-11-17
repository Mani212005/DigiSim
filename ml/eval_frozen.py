"""
Module: eval_frozen.py
Purpose: Frozen-test-set integrity for the evaluation harness. Computes a deterministic SHA-256
         over a dataset split (every image, label and optional ground-truth netlist file plus the
         class names) and compares it with the registry in ml/frozen_sets.json, so an evaluation
         refuses to run when the frozen test set was edited, regenerated or re-labelled.

Registry format (ml/frozen_sets.json):
    {"<frozen name>": {"sha256": "...", "split": "test", "images": 78, "labels": 78, "netlists": 0,
                       "classes": [...], "note": "..."}}
"""

import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

ML_DIR = Path(__file__).resolve().parent
DEFAULT_REGISTRY = ML_DIR / "frozen_sets.json"
IMAGE_SUFFIXES = frozenset({".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"})


class FrozenSetError(RuntimeError):
    """Raised when a frozen set is missing from the registry or its hash no longer matches."""


@dataclass(frozen=True)
class SplitDigest:
    """The digest of one dataset split and the file counts that went into it."""

    sha256: str
    images: int
    labels: int
    netlists: int
    classes: tuple[str, ...]


def file_sha256(path: Path) -> str:
    """
    SHA-256 of a file's bytes.

    Args:
        path: File to hash.
    Returns:
        Lower-case hex digest.
    """
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def hash_split(images_dir: Path, labels_dir: Path, netlists_dir: Path, class_names: Sequence[str]) -> SplitDigest:
    """
    Deterministic digest of a dataset split, over exactly the directories an evaluation reads.

    Args:
        images_dir: Directory holding the split's images.
        labels_dir: Directory holding the split's YOLO label files.
        netlists_dir: Directory holding the split's ground-truth netlists (may not exist).
        class_names: Class names in id order (label ids are meaningless without them).
    Returns:
        The SplitDigest. Only *.txt labels, image files and *.json netlists count; caches are ignored.
    Raises:
        FileNotFoundError: If the image or label directory does not exist.
    """
    for required in (images_dir, labels_dir):
        if not required.is_dir():
            raise FileNotFoundError(f"Split directory missing: {required}")
    entries: list[tuple[str, str]] = []
    counts = {"images": 0, "labels": 0, "netlists": 0}
    for kind, folder, keep in (
        ("images", images_dir, lambda p: p.suffix.lower() in IMAGE_SUFFIXES),
        ("labels", labels_dir, lambda p: p.suffix == ".txt"),
        ("netlists", netlists_dir, lambda p: p.suffix == ".json"),
    ):
        if not folder.is_dir():
            continue
        for path in sorted(folder.iterdir()):
            if path.is_file() and keep(path):
                entries.append((f"{kind}/{path.name}", file_sha256(path)))
                counts[kind] += 1
    digest = hashlib.sha256()
    digest.update(("classes\t" + json.dumps(list(class_names)) + "\n").encode())
    for rel, file_hash in sorted(entries):
        digest.update(f"{rel}\t{file_hash}\n".encode())
    return SplitDigest(
        sha256=digest.hexdigest(),
        images=counts["images"],
        labels=counts["labels"],
        netlists=counts["netlists"],
        classes=tuple(class_names),
    )


def load_registry(path: Path = DEFAULT_REGISTRY) -> dict[str, dict[str, object]]:
    """
    Load the frozen-set registry.

    Args:
        path: Registry JSON path.
    Returns:
        Mapping frozen name -> entry; empty when the file does not exist.
    Raises:
        ValueError: If the file is not a JSON object.
    """
    if not path.exists():
        return {}
    raw = json.loads(path.read_text())
    if not isinstance(raw, dict):
        raise ValueError(f"{path}: expected a JSON object of frozen sets")
    return raw


def infer_frozen_name(split: str, class_names: Sequence[str], registry_path: Path = DEFAULT_REGISTRY) -> str | None:
    """
    The frozen set a run should be checked against when --frozen-name is omitted.

    Args:
        split: Split being evaluated.
        class_names: Class names of the dataset, in id order.
        registry_path: Registry JSON path.
    Returns:
        The registry name when exactly one entry has this split and class list, otherwise None
        (no match or an ambiguous match: the caller must ask for an explicit name).
    """
    matches = [name for name, entry in load_registry(registry_path).items() if entry.get("split") == split and entry.get("classes") == list(class_names)]
    return matches[0] if len(matches) == 1 else None


def verify_frozen(name: str, digest: SplitDigest, registry_path: Path = DEFAULT_REGISTRY) -> None:
    """
    Refuse (raise) unless the split digest equals the registered frozen hash.

    Args:
        name: Frozen set name in the registry.
        digest: Digest computed from the dataset on disk.
        registry_path: Registry JSON path.
    Raises:
        FrozenSetError: If the name is unregistered or the hash differs from the registered one.
    """
    registry = load_registry(registry_path)
    entry = registry.get(name)
    if entry is None:
        raise FrozenSetError(f"Frozen set {name!r} is not registered in {registry_path}; freeze it first with --freeze (deliberate, reviewed change)")
    expected = str(entry.get("sha256", ""))
    if expected != digest.sha256:
        raise FrozenSetError(
            f"Frozen set {name!r} changed: registered sha256 {expected[:16]}... but the dataset on disk hashes to {digest.sha256[:16]}... "
            "The frozen test set must never be edited; refusing to evaluate."
        )


def freeze(name: str, digest: SplitDigest, split: str, note: str, registry_path: Path = DEFAULT_REGISTRY) -> None:
    """
    Register a new frozen set.

    Args:
        name: Frozen set name.
        digest: Digest of the split to freeze.
        split: Split the digest was computed from.
        note: Free-text provenance (what the set is, where it came from).
        registry_path: Registry JSON path.
    Raises:
        FrozenSetError: If the name is already registered (frozen sets are never overwritten by tooling).
    """
    registry = load_registry(registry_path)
    if name in registry:
        raise FrozenSetError(f"Frozen set {name!r} already registered in {registry_path}; refusing to overwrite it")
    registry[name] = {
        "sha256": digest.sha256,
        "split": split,
        "images": digest.images,
        "labels": digest.labels,
        "netlists": digest.netlists,
        "classes": list(digest.classes),
        "note": note,
    }
    registry_path.write_text(json.dumps(registry, indent=2, sort_keys=True) + "\n")
