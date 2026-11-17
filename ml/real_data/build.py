"""
Module: build.py
Purpose: Command line entry point of the real-data ingestion (T4). Subcommands:
           fetch    download the CGHD pilot drafters from the Hugging Face mirror (images + VOC annotations only)
           sheets   render the transistor review sheets used for the NMOS/PMOS relabelling pass
           convert  build the YOLO dataset (CGHD pilot + Roboflow + Sampleimages), the manifest and the report
           verify   re-check the committed manifest: no drafter / source image / image content in two splits
           report   rewrite REAL_DATA_REPORT.md from the manifest
         Fetched and converted data live under ml/data_real/ (gitignored); only the manifest, report, licences,
         our own label files and these scripts are committed.

Usage:
    cd ml
    uv run python -m real_data.build fetch
    uv run python -m real_data.build sheets
    uv run python -m real_data.build convert
    uv run python -m real_data.build verify
"""

import argparse
import hashlib
import json
import shutil
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps

from class_schema import ClassSchema, load_schema, render_data_yaml
from real_data import config
from real_data.cghd import IgnoredBox, LabelBox, VocAnnotation, convert_annotation, drafter_of, parse_voc
from real_data.class_remap import validate_remaps
from real_data.fet_polarity import drawing_of, fet_objects, load_polarity, propagate_polarity, render_review_sheet
from real_data.report import render_report
from real_data.roboflow import load_roboflow, load_sample_labels
from real_data.splits import ImageRecord, dhash, sha256_file, split_hash, verify_no_leakage

MANIFEST_VERSION = 1
IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png")


@dataclass(frozen=True)
class ImageJob:
    """One image to write into the YOLO dataset, with everything needed to label it and record it."""

    split: str
    source: str
    group: str
    source_id: str
    out_name: str
    image_path: Path
    size: tuple[int, int]
    boxes: tuple[LabelBox, ...]
    ignored: tuple[IgnoredBox, ...] = ()


def parse_pilot(spec: str) -> dict[int, str]:
    """
    Parse a pilot spec such as "19:train,25:train,16:valid,20:test".

    Args:
        spec: Comma separated drafter:split pairs.
    Returns:
        Drafter number -> split name.
    Raises:
        ValueError: If a pair is malformed or names a split that is not train, valid or test.
    """
    pilot: dict[int, str] = {}
    for pair in spec.split(","):
        drafter, _, split = pair.partition(":")
        if split not in ("train", "valid", "test"):
            raise ValueError(f"Bad pilot entry {pair!r}: split must be train, valid or test")
        pilot[int(drafter)] = split
    return pilot


def fetch(pilot: dict[int, str]) -> None:
    """
    Download the pilot drafters' images and VOC annotations from the pinned Hugging Face revision.

    Args:
        pilot: Drafter number -> split; only the keys are used.
    Raises:
        ImportError: If huggingface_hub is not installed.
    """
    from huggingface_hub import snapshot_download

    patterns = [f"drafter_{d}/{kind}/*" for d in sorted(pilot) for kind in ("images", "annotations")]
    config.RAW_CGHD_DIR.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=config.CGHD_HF_REPO,
        repo_type="dataset",
        revision=config.CGHD_HF_REVISION,
        allow_patterns=patterns,
        local_dir=config.RAW_CGHD_DIR,
        max_workers=4,
    )


def find_image(drafter_dir: Path, stem: str) -> Path | None:
    """
    The image file of a CGHD annotation (the extension varies: jpg, jpeg, png in either case).

    Args:
        drafter_dir: The drafter_<n> directory.
        stem: Image stem.
    Returns:
        The image path, or None if it is not on disk.
    """
    for path in sorted((drafter_dir / "images").glob(stem + ".*")):
        if path.suffix.lower() in IMAGE_SUFFIXES:
            return path
    return None


def load_pilot_annotations(pilot: dict[int, str]) -> dict[str, tuple[VocAnnotation, Path]]:
    """
    Parse every annotation of the pilot drafters together with its image path.

    Args:
        pilot: Drafter number -> split.
    Returns:
        Image key ("drafter_19/C37_D1_P1") -> (annotation, image path), sorted by key.
    Raises:
        FileNotFoundError: If a drafter folder or an annotation's image is missing (run `fetch` first).
    """
    found: dict[str, tuple[VocAnnotation, Path]] = {}
    for drafter in sorted(pilot):
        drafter_dir = config.RAW_CGHD_DIR / f"drafter_{drafter}"
        if not (drafter_dir / "annotations").is_dir():
            raise FileNotFoundError(f"{drafter_dir} is missing; run `python -m real_data.build fetch`")
        for xml_path in sorted((drafter_dir / "annotations").glob("*.xml")):
            image = find_image(drafter_dir, xml_path.stem)
            if image is None:
                raise FileNotFoundError(f"No image for annotation {xml_path}")
            found[f"drafter_{drafter}/{xml_path.stem}"] = (parse_voc(xml_path), image)
    return found


def to_yolo_rows(boxes: tuple[LabelBox, ...], width: int, height: int, class_ids: dict[str, int]) -> list[str]:
    """
    Normalised YOLO label rows for pixel boxes, clipped to the image.

    Args:
        boxes: Labelled boxes in pixel coordinates.
        width: Image width.
        height: Image height.
        class_ids: Class name -> YOLO id.
    Returns:
        Rows "<id> <cx> <cy> <w> <h>" (6 decimals); boxes that clip to nothing are dropped.
    """
    rows = []
    for box in boxes:
        x1, x2 = max(0.0, box.xmin), min(float(width), box.xmax)
        y1, y2 = max(0.0, box.ymin), min(float(height), box.ymax)
        if x2 - x1 < 1 or y2 - y1 < 1:
            continue
        rows.append(f"{class_ids[box.class_name]} {(x1 + x2) / 2 / width:.6f} {(y1 + y2) / 2 / height:.6f} {(x2 - x1) / width:.6f} {(y2 - y1) / height:.6f}")
    return rows


def write_image(src: Path, dst: Path, expected_size: tuple[int, int] | None) -> bool:
    """
    Copy an image into the YOLO dataset, baking in its EXIF orientation when it has one.

    Args:
        src: Source image.
        dst: Destination path.
        expected_size: (width, height) the labels were drawn against, or None to skip the check.
    Returns:
        True if the orientation was applied and removed (the copy was re-encoded), False for a byte copy.
    Raises:
        ValueError: If the final image size does not match expected_size.
    """
    with Image.open(src) as im:
        orientation = im.getexif().get(274, 1)
        if orientation == 1:
            size = im.size
            baked = False
        else:
            upright = ImageOps.exif_transpose(im)
            size = upright.size
            baked = True
    if expected_size is not None and size != expected_size:
        raise ValueError(f"{src}: image size {size} does not match annotation size {expected_size}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    if not baked:
        shutil.copy2(src, dst)
    else:
        with Image.open(src) as im:
            upright = ImageOps.exif_transpose(im)
            if src.suffix.lower() in (".jpg", ".jpeg"):
                upright.save(dst, quality=95, subsampling=0)
            else:
                upright.save(dst)
    return baked


def write_labels(label_path: Path, ignore_path: Path, rows: list[str], ignored: list[dict]) -> str:
    """
    Write the YOLO label file and the ignore-region sidecar.

    Args:
        label_path: Destination of the label txt.
        ignore_path: Destination of the ignore json.
        rows: YOLO rows.
        ignored: Ignore regions (reason, source_class, xyxy).
    Returns:
        SHA-256 of the label file content.
    """
    text = "\n".join(rows) + ("\n" if rows else "")
    label_path.parent.mkdir(parents=True, exist_ok=True)
    ignore_path.parent.mkdir(parents=True, exist_ok=True)
    label_path.write_text(text)
    ignore_path.write_text(json.dumps(ignored, indent=1, sort_keys=True) + "\n")
    return hashlib.sha256(text.encode()).hexdigest()


def convert(pilot: dict[int, str]) -> dict:
    """
    Build the YOLO dataset under ml/data_real/yolo and return the manifest.

    Args:
        pilot: Drafter number -> split for the CGHD pilot.
    Returns:
        The manifest dict (also written to ml/data_manifest.json by the caller).
    Raises:
        FileNotFoundError: If fetched data or the repo's Roboflow/Sampleimages inputs are missing.
        ValueError: If an image size disagrees with its annotation.
    """
    schema = load_schema()
    validate_remaps(schema)
    class_ids = {c.name: c.id for c in schema.classes}
    if config.YOLO_DIR.exists():
        shutil.rmtree(config.YOLO_DIR)

    records: list[ImageRecord] = []
    ignored_totals: Counter[str] = Counter()

    annotations = load_pilot_annotations(pilot)
    refs = load_polarity(config.FET_POLARITY_PATH)
    polarity, residuals = propagate_polarity(refs, {k: v[0] for k, v in annotations.items()})
    polarity_counts: Counter[str] = Counter(polarity.values())
    for key, (ann, image_path) in annotations.items():
        drafter = drafter_of(image_path)
        split = pilot[drafter]
        stem = Path(key).name
        out_name = f"cghd_d{drafter}_{stem}"
        converted = convert_annotation(ann, polarity, key)
        job = ImageJob(split, "cghd", f"drafter_{drafter}", f"cghd/{key}", out_name, image_path, (ann.width, ann.height), converted.boxes, converted.ignored)
        records.append(_emit(schema, class_ids, job, ignored_totals))

    for src in load_roboflow(config.ROBOFLOW_DIR, config.ROBOFLOW_SPLITS) + load_sample_labels(config.SAMPLE_DIR, config.SAMPLE_LABELS_PATH, "heldout_qual"):
        prefix = "rf" if src.source_id.startswith("roboflow/") else "sample"
        out_name = f"{prefix}_{Path(src.source_id).stem}"
        source = src.source_id.split("/")[0]
        job = ImageJob(src.split, source, src.source_id, src.source_id, out_name, src.image_path, (src.width, src.height), src.boxes)
        records.append(_emit(schema, class_ids, job, ignored_totals))

    records.sort(key=lambda r: r.name)
    (config.YOLO_DIR / "data.yaml").write_text(render_data_yaml(schema, config.YOLO_DIR, max_tier="B"))
    return build_manifest(schema, pilot, records, ignored_totals, polarity_counts, refs, residuals)


def _emit(schema: ClassSchema, class_ids: dict[str, int], job: ImageJob, ignored_totals: Counter) -> ImageRecord:
    """
    Write one image + labels + ignore sidecar into the YOLO dataset and build its manifest record.

    Args:
        schema: Class schema (for the legality check of class names).
        class_ids: Class name -> YOLO id.
        job: The image to write.
        ignored_totals: Running per-reason counter, updated in place.
    Returns:
        The ImageRecord.
    Raises:
        ValueError: If a box uses a class that is not in classes.yaml.
    """
    unknown = {b.class_name for b in job.boxes} - set(schema.names)
    if unknown:
        raise ValueError(f"{job.source_id}: classes not in classes.yaml: {sorted(unknown)}")
    dst = config.YOLO_DIR / "images" / job.split / f"{job.out_name}{job.image_path.suffix.lower()}"
    baked = write_image(job.image_path, dst, job.size)
    rows = to_yolo_rows(job.boxes, job.size[0], job.size[1], class_ids)
    ignore_rows = [{"reason": i.reason, "source_class": i.source_class, "xyxy": [i.xmin, i.ymin, i.xmax, i.ymax]} for i in job.ignored]
    label_sha = write_labels(config.YOLO_DIR / "labels" / job.split / f"{job.out_name}.txt", config.YOLO_DIR / "ignore" / job.split / f"{job.out_name}.json", rows, ignore_rows)
    ignored_totals.update(i.reason for i in job.ignored)
    counts = Counter(schema.names[int(r.split()[0])] for r in rows)
    return ImageRecord(
        name=job.out_name,
        split=job.split,
        source=job.source,
        group=job.group,
        source_id=job.source_id,
        sha256=sha256_file(job.image_path),
        label_sha256=label_sha,
        dhash=dhash(dst),
        width=job.size[0],
        height=job.size[1],
        exif_baked=baked,
        class_counts=dict(sorted(counts.items())),
        ignored_counts=dict(sorted(Counter(i["reason"] for i in ignore_rows).items())),
    )


def build_manifest(schema: ClassSchema, pilot: dict[int, str], records: list[ImageRecord], ignored_totals: Counter, polarity_counts: Counter, refs: dict, residuals: dict[str, float]) -> dict:
    """
    Assemble the committed manifest (deterministic: no timestamps, sorted keys).

    Args:
        schema: Class schema.
        pilot: Drafter -> split of the CGHD pilot.
        records: All image records.
        ignored_totals: Ignore-region counts per reason.
        polarity_counts: Instance counts per polarity decision (NMOS, PMOS, UNCERTAIN).
        refs: Reference polarity decisions.
        residuals: Worst match distance per propagated photo.
    Returns:
        The manifest dict.
    """
    splits: dict[str, dict] = {}
    for split in config.SPLITS:
        members = [r for r in records if r.split == split]
        if not members:
            continue
        class_counts: Counter[str] = Counter()
        for r in members:
            class_counts.update(r.class_counts)
        splits[split] = {
            "images": len(members),
            "hash": split_hash(records, split),
            "sources": dict(sorted(Counter(r.source for r in members).items())),
            "groups": sorted({r.group for r in members}),
            "class_counts": {n: class_counts.get(n, 0) for n in schema.names},
        }
    matched = [v for v in residuals.values() if v > 0]
    return {
        "manifest_version": MANIFEST_VERSION,
        "classes": list(schema.names),
        "cghd": {
            "hf_repo": config.CGHD_HF_REPO,
            "hf_revision": config.CGHD_HF_REVISION,
            "zenodo": config.CGHD_ZENODO_RECORD,
            "drafter_splits": {f"drafter_{d}": s for d, s in sorted(pilot.items())},
        },
        "fet_polarity": {
            "reference_decisions": sum(len(v) for v in refs.values()),
            "NMOS": polarity_counts.get("NMOS", 0),
            "PMOS": polarity_counts.get("PMOS", 0),
            "UNCERTAIN": polarity_counts.get("UNCERTAIN", 0),
            "propagated_photos": len(matched),
            "worst_match_residual": round(max(matched), 4) if matched else 0.0,
        },
        "ignored_totals": dict(sorted(ignored_totals.items())),
        "splits": splits,
        "images": [r.__dict__ for r in records],
    }


def manifest_records(manifest: dict) -> list[ImageRecord]:
    """
    Rebuild ImageRecords from a manifest dict.

    Args:
        manifest: Loaded manifest.
    Returns:
        The image records.
    """
    return [ImageRecord(**entry) for entry in manifest["images"]]


def verify(manifest: dict, check_files: bool) -> list[str]:
    """
    Verify a manifest: no leakage, split hashes match their members, and (optionally) files match their hashes.

    Args:
        manifest: Loaded manifest.
        check_files: Also re-hash the YOLO label files and the upstream images on disk when present.
    Returns:
        Violations; empty means the manifest is consistent and leak-free.
    """
    records = manifest_records(manifest)
    problems = verify_no_leakage(records)
    for split, info in manifest["splits"].items():
        if info["hash"] != split_hash(records, split):
            problems.append(f"split {split}: stored hash does not match its members")
    pilot = manifest["cghd"]["drafter_splits"]
    for rec in records:
        if rec.source == "cghd" and pilot.get(rec.group) != rec.split:
            problems.append(f"{rec.name}: in split {rec.split} but {rec.group} is assigned to {pilot.get(rec.group)}")
    if check_files:
        for rec in records:
            label = config.YOLO_DIR / "labels" / rec.split / f"{rec.name}.txt"
            if label.exists() and hashlib.sha256(label.read_bytes()).hexdigest() != rec.label_sha256:
                problems.append(f"{rec.name}: label file hash changed")
    return problems


def cmd_sheets(pilot: dict[int, str]) -> None:
    """
    Render review sheets for every drawing that contains transistors (one reference photo per drawing).

    Args:
        pilot: Drafter -> split.
    """
    annotations = load_pilot_annotations(pilot)
    config.REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    refs: dict[str, str] = {}
    for key, (ann, image) in annotations.items():
        if fet_objects(ann):
            refs.setdefault(f"{Path(key).parent}/{drawing_of(Path(key).name)}", key)
    for ref_key in sorted(refs.values()):
        ann, image = annotations[ref_key]
        title = ref_key
        sheets = render_review_sheet(image, fet_objects(ann), title, config.REVIEW_DIR / ref_key.replace("/", "_"))
        print(f"{ref_key}: {len(fet_objects(ann))} transistors -> {', '.join(p.name for p in sheets)}")


def main(argv: list[str] | None = None) -> int:
    """
    CLI entry point.

    Args:
        argv: Argument list (defaults to sys.argv[1:]).
    Returns:
        Process exit code (1 when verify finds violations).
    """
    parser = argparse.ArgumentParser(description="DigiSim real-data ingestion (T4)")
    parser.add_argument("command", choices=["fetch", "sheets", "convert", "verify", "report"])
    parser.add_argument("--pilot", default=",".join(f"{d}:{s}" for d, s in config.CGHD_PILOT_SPLITS.items()), help="drafter:split pairs for the CGHD pilot")
    args = parser.parse_args(argv)
    pilot = parse_pilot(args.pilot)

    if args.command == "fetch":
        fetch(pilot)
    elif args.command == "sheets":
        cmd_sheets(pilot)
    elif args.command == "convert":
        manifest = convert(pilot)
        config.MANIFEST_PATH.write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n")
        (config.ML_DIR / "REAL_DATA_REPORT.md").write_text(render_report(manifest))
        problems = verify(manifest, check_files=True)
        for p in problems:
            print("VIOLATION:", p)
        print(f"wrote {config.MANIFEST_PATH.name}: {len(manifest['images'])} images, {len(problems)} violations")
        return 1 if problems else 0
    elif args.command == "verify":
        manifest = json.loads(config.MANIFEST_PATH.read_text())
        problems = verify(manifest, check_files=config.YOLO_DIR.exists())
        for p in problems:
            print("VIOLATION:", p)
        print("OK: no drafter, source image or image content appears in two splits" if not problems else f"{len(problems)} violations")
        return 1 if problems else 0
    elif args.command == "report":
        manifest = json.loads(config.MANIFEST_PATH.read_text())
        (config.ML_DIR / "REAL_DATA_REPORT.md").write_text(render_report(manifest))
    return 0


if __name__ == "__main__":
    sys.exit(main())
