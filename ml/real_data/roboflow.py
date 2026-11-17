"""
Module: roboflow.py
Purpose: Reads the 46-image Roboflow gate export that is already tracked in the repo (7-point polygon
         labels, 6 gate classes) and our own manual labels for the 4 spare Sampleimages, and turns both into
         pixel-space boxes in the classes.yaml vocabulary. The export has no augmentation, so every image is a
         distinct source image and the existing train/valid/test split is kept as it is.
"""

import json
import re
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from real_data.cghd import LabelBox
from real_data.class_remap import ROBOFLOW_NAMES

_ROBOFLOW_NAME = re.compile(r"^(?P<source>.+)_jpg\.rf\.[A-Za-z0-9]+\.jpg$")


@dataclass(frozen=True)
class SourceImage:
    """One real image with its labels in pixel coordinates."""

    split: str
    source_id: str
    image_path: Path
    width: int
    height: int
    boxes: tuple[LabelBox, ...]


def polygon_to_box(coords: list[float]) -> tuple[float, float, float, float]:
    """
    Axis-aligned bounding box of a normalised polygon (or box) label row.

    Args:
        coords: Flat normalised values after the class id: x1 y1 x2 y2 ... for a polygon, or cx cy w h for
            a plain YOLO box (exactly four values).
    Returns:
        (xmin, ymin, xmax, ymax) in normalised coordinates.
    Raises:
        ValueError: If fewer than four values are given, or a polygon has an odd number of values.
    """
    if len(coords) < 4:
        raise ValueError(f"Label needs at least 4 values, got {len(coords)}")
    if len(coords) == 4:
        cx, cy, w, h = coords
        return cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
    if len(coords) % 2:
        raise ValueError(f"Polygon needs an even number of values, got {len(coords)}")
    xs, ys = coords[0::2], coords[1::2]
    return min(xs), min(ys), max(xs), max(ys)


def roboflow_source_name(filename: str) -> str:
    """
    Original image name from a Roboflow export file name.

    Args:
        filename: e.g. "eleventh_image_jpg.rf.O7hixbrwyCKa0EUTHYm9.jpg".
    Returns:
        The source name, e.g. "eleventh_image.jpg" (the name used in Sampleimages/).
    Raises:
        ValueError: If the file name does not follow the Roboflow pattern.
    """
    match = _ROBOFLOW_NAME.match(filename)
    if not match:
        raise ValueError(f"Not a Roboflow export file name: {filename}")
    return match.group("source") + ".jpg"


def load_roboflow(export_dir: Path, split_map: dict[str, str]) -> list[SourceImage]:
    """
    Load the Roboflow export with polygon labels converted to boxes.

    Args:
        export_dir: The "My First Project.yolov8" directory.
        split_map: Export split directory name -> our split name.
    Returns:
        One SourceImage per image, sorted by split then name. Source ids are "roboflow/<original name>".
    Raises:
        FileNotFoundError: If the export or its data.yaml is missing.
        ValueError: If a label row uses an unknown class id.
    """
    data_yaml = export_dir / "data.yaml"
    if not data_yaml.exists():
        raise FileNotFoundError(data_yaml)
    names = _read_names(data_yaml)
    images: list[SourceImage] = []
    for src_split, split in split_map.items():
        image_dir = export_dir / src_split / "images"
        for image_path in sorted(image_dir.iterdir()):
            label_path = export_dir / src_split / "labels" / (image_path.stem + ".txt")
            with Image.open(image_path) as im:
                width, height = im.size
            boxes: list[LabelBox] = []
            for line in label_path.read_text().splitlines():
                parts = line.split()
                if not parts:
                    continue
                class_id = int(parts[0])
                if class_id >= len(names):
                    raise ValueError(f"{label_path}: unknown class id {class_id}")
                x1, y1, x2, y2 = polygon_to_box([float(v) for v in parts[1:]])
                boxes.append(LabelBox(ROBOFLOW_NAMES[names[class_id]], x1 * width, y1 * height, x2 * width, y2 * height))
            source = roboflow_source_name(image_path.name)
            images.append(SourceImage(split, f"roboflow/{source}", image_path, width, height, tuple(boxes)))
    return images


def _read_names(data_yaml: Path) -> list[str]:
    """
    Class names from a Roboflow data.yaml (the `names: [...]` line).

    Args:
        data_yaml: Path to data.yaml.
    Returns:
        Class names in id order.
    Raises:
        ValueError: If no names line is found.
    """
    for line in data_yaml.read_text().splitlines():
        if line.startswith("names:"):
            return [n.strip().strip("'\"") for n in line.split(":", 1)[1].strip().strip("[]").split(",")]
    raise ValueError(f"{data_yaml}: no names: line")


def load_sample_labels(sample_dir: Path, labels_path: Path, split: str) -> list[SourceImage]:
    """
    Load our manual labels for the spare Sampleimages.

    Args:
        sample_dir: The Sampleimages directory.
        labels_path: sample_labels.json.
        split: Split name to assign (heldout_qual).
    Returns:
        One SourceImage per labelled image. Source ids are "sampleimages/<name>".
    Raises:
        FileNotFoundError: If the labels file or a labelled image is missing.
        ValueError: If a stored image size no longer matches the image on disk.
    """
    if not labels_path.exists():
        raise FileNotFoundError(labels_path)
    doc = json.loads(labels_path.read_text())
    images: list[SourceImage] = []
    for name, entry in sorted(doc["images"].items()):
        image_path = sample_dir / name
        with Image.open(image_path) as im:
            width, height = im.size
        if (width, height) != (entry["width"], entry["height"]):
            raise ValueError(f"{name}: size {(width, height)} differs from labelled {(entry['width'], entry['height'])}")
        boxes = tuple(LabelBox(b["class"], *map(float, b["xyxy"])) for b in entry["boxes"])
        images.append(SourceImage(split, f"sampleimages/{name}", image_path, width, height, boxes))
    return images
