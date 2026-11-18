"""
Module: test_eval_frozen.py
Purpose: Unit tests for ml/eval_frozen.py - the frozen test-set hash is deterministic, sensitive to
         any image/label/netlist/class change, ignores caches, and the registry refuses unknown,
         changed and re-frozen sets.
"""

from pathlib import Path

import pytest

from eval_frozen import FrozenSetError, SplitDigest, freeze, hash_split, verify_frozen

NAMES = ["A", "B"]


def make_dataset(root: Path) -> Path:
    """
    Create a tiny dataset with a test split.

    Args:
        root: Dataset root to populate.
    Returns:
        The root.
    """
    (root / "images" / "test").mkdir(parents=True)
    (root / "labels" / "test").mkdir(parents=True)
    (root / "images" / "test" / "syn_0.jpg").write_bytes(b"image-bytes")
    (root / "labels" / "test" / "syn_0.txt").write_text("0 0.5 0.5 0.1 0.1\n")
    return root


def hash_test_split(root: Path, names: list[str]) -> SplitDigest:
    """
    Hash the conventional images/test, labels/test and netlists/test directories of a dataset.

    Args:
        root: Dataset root.
        names: Class names in id order.
    Returns:
        The split digest.
    """
    return hash_split(root / "images" / "test", root / "labels" / "test", root / "netlists" / "test", names)


def test_hash_is_deterministic_and_ignores_caches(tmp_path: Path) -> None:
    """Same bytes -> same hash; a label cache file does not change it."""
    root = make_dataset(tmp_path / "d")
    first = hash_test_split(root, NAMES)
    (root / "labels" / "test.cache").write_bytes(b"cache")
    again = hash_test_split(root, NAMES)
    assert first == again and first.images == 1 and first.labels == 1 and first.netlists == 0


@pytest.mark.parametrize("change", ["label", "image", "classes", "extra_label", "netlist"])
def test_hash_changes_when_anything_changes(tmp_path: Path, change: str) -> None:
    """Editing a label or image, reordering classes, adding a file or a netlist all change the hash."""
    root = make_dataset(tmp_path / "d")
    before = hash_test_split(root, NAMES).sha256
    names = NAMES
    if change == "label":
        (root / "labels" / "test" / "syn_0.txt").write_text("1 0.5 0.5 0.1 0.1\n")
    elif change == "image":
        (root / "images" / "test" / "syn_0.jpg").write_bytes(b"other")
    elif change == "classes":
        names = ["B", "A"]
    elif change == "extra_label":
        (root / "labels" / "test" / "syn_1.txt").write_text("")
    else:
        (root / "netlists" / "test").mkdir(parents=True)
        (root / "netlists" / "test" / "syn_0.json").write_text("{}")
    assert hash_test_split(root, names).sha256 != before


def test_registry_refuses_unknown_changed_and_refrozen(tmp_path: Path) -> None:
    """verify_frozen raises for unregistered and modified sets; freeze never overwrites."""
    root = make_dataset(tmp_path / "d")
    registry = tmp_path / "frozen.json"
    digest = hash_test_split(root, NAMES)
    with pytest.raises(FrozenSetError, match="not registered"):
        verify_frozen("t", digest, registry)
    freeze("t", digest, "test", "note", registry)
    verify_frozen("t", digest, registry)
    with pytest.raises(FrozenSetError, match="already registered"):
        freeze("t", digest, "test", "note", registry)
    (root / "labels" / "test" / "syn_0.txt").write_text("1 0.5 0.5 0.1 0.1\n")
    with pytest.raises(FrozenSetError, match="changed"):
        verify_frozen("t", hash_test_split(root, NAMES), registry)


def test_missing_split_directory_raises(tmp_path: Path) -> None:
    """A dataset without the requested split cannot be hashed."""
    with pytest.raises(FileNotFoundError):
        hash_test_split(tmp_path, NAMES)


def test_hash_follows_the_directories_it_is_given(tmp_path: Path) -> None:
    """The digest depends on the directories passed in, not on a split name: identical bytes elsewhere hash the same."""
    root = make_dataset(tmp_path / "d")
    other = tmp_path / "other"
    (other / "pics").mkdir(parents=True)
    (other / "tags").mkdir()
    (other / "pics" / "syn_0.jpg").write_bytes(b"image-bytes")
    (other / "tags" / "syn_0.txt").write_text("0 0.5 0.5 0.1 0.1\n")
    assert hash_split(other / "pics", other / "tags", other / "none", NAMES).sha256 == hash_test_split(root, NAMES).sha256


def test_ignore_regions_join_the_hash_only_when_present(tmp_path: Path) -> None:
    """A split without ignore regions hashes as before; adding or editing an ignore file changes the hash."""
    root = make_dataset(tmp_path / "d")
    ignore = root / "ignore" / "test"
    plain = hash_test_split(root, NAMES).sha256
    assert hash_split(root / "images" / "test", root / "labels" / "test", root / "netlists" / "test", NAMES, ignore).sha256 == plain
    ignore.mkdir(parents=True)
    (ignore / "syn_0.json").write_text('[{"reason": "uncertain_fet", "xyxy": [0, 0, 5, 5]}]')
    with_ignore = hash_split(root / "images" / "test", root / "labels" / "test", root / "netlists" / "test", NAMES, ignore).sha256
    assert with_ignore != plain
    (ignore / "syn_0.json").write_text('[{"reason": "uncertain_fet", "xyxy": [0, 0, 6, 5]}]')
    assert hash_split(root / "images" / "test", root / "labels" / "test", root / "netlists" / "test", NAMES, ignore).sha256 != with_ignore
