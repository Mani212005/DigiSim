"""
Module: generate_v2.py
Purpose: Synthetic circuit dataset generator v2. Samples netlist-driven circuits (transistor-level
         CMOS and gate-level), lays them out and routes them like textbook schematics, renders
         them in clean, textbook, hand-drawn and phone-photo styles, and writes per sample:
         a JPEG, YOLO box labels (ml/classes.yaml ids), an annotation JSON (pins, orientation,
         junctions, wires, crossings, texts) and a netlist JSON (components, nets, reference
         truth table). Splits are by topology hash; some test samples use held-out styles.
         Output is fully deterministic per (--seed, sample index), so the manifest is
         byte-identical across runs and worker counts.

Usage:
    cd backend && uv run python data_gen/generate_v2.py --count 8000 --seed 1
    cd backend && uv run python data_gen/generate_v2.py --count 200 --seed 1 --out /tmp/synth --workers 4
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections import Counter
from dataclasses import dataclass
from multiprocessing import Pool
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from data_gen.synth_v2.layout import LayoutError, build_layout, sample_draw_style  # noqa: E402
from data_gen.synth_v2.logic import Circuit, sample_circuit, topology_hash  # noqa: E402
from data_gen.synth_v2.render import DOT_MAX_PER_1000, DOT_MIN_PER_1000, render, sample_render_style  # noqa: E402
from data_gen.synth_v2.schema import CLASS_ID, NODE_TYPE, REPO_ROOT, SCHEMA, SCHEMA_VERSION, TIER_A, render_data_yaml  # noqa: E402

GENERATOR_VERSION = 1
DEFAULT_OUT = REPO_ROOT / "ml" / "dataset" / "synth_v2"
SPLITS: tuple[str, ...] = ("train", "valid", "test")
DOMAIN_WEIGHTS: tuple[tuple[str, float], ...] = (("transistor", 0.7), ("gate", 0.3))
HELD_OUT_FRACTION = 0.5
DOMAIN_CLASSES: dict[str, tuple[str, ...]] = {
    "transistor": ("NMOS", "PMOS", "VDD", "GND", "INPUT_PORT", "OUTPUT_PORT", "JUNCTION"),
    "gate": ("AND", "OR", "NOT", "NAND", "NOR", "XOR", "XNOR", "INPUT_PORT", "OUTPUT_PORT", "JUNCTION"),
}
BALANCE_MIN_RATIO = 0.10


@dataclass
class Sample:
    """Everything generated for one sample index, ready to write."""

    index: int
    sample_id: str
    split: str
    domain: str
    recipe: str
    topology: str
    held_out: bool
    image: bytes
    label: str
    annotation: dict
    netlist: dict


def split_for(topology: str) -> str:
    """
    Deterministic split from a topology hash (about 80/10/10).

    Args:
        topology: Hex topology hash.
    Returns:
        "train", "valid" or "test".
    """
    bucket = int(topology[:8], 16) % 100
    return "train" if bucket < 80 else ("valid" if bucket < 90 else "test")


def build_netlist(circuit: Circuit, annotation: dict, topology: str) -> dict:
    """
    Netlist JSON for a sample: drawn components (devices, ports, supplies), nets and truth table.

    Args:
        circuit: Sampled circuit.
        annotation: Render annotation (its symbols carry the drawn components and nets).
        topology: Topology hash.
    Returns:
        JSON-serialisable netlist.
    """
    components = []
    nets: set[str] = set()
    for sym in sorted(annotation["symbols"], key=lambda s: s["id"]):
        pins = dict(sorted(sym["nets"].items()))
        nets.update(pins.values())
        comp = {"id": sym["id"], "class": sym["class"], "node_type": NODE_TYPE[sym["class"]], "pins": pins}
        if sym["class"] in ("INPUT_PORT", "OUTPUT_PORT"):
            comp["label"] = next(iter(pins.values()))
        components.append(comp)
    return {
        "version": GENERATOR_VERSION,
        "domain": circuit.domain,
        "recipe": circuit.recipe,
        "topology_hash": topology,
        "inputs": list(circuit.inputs),
        "outputs": list(circuit.outputs),
        "nets": sorted(nets),
        "components": components,
        "truth_table": circuit.truth_table(),
    }


def yolo_label(annotation: dict) -> str:
    """
    YOLO label text: one line per symbol and junction dot, normalised center/size.

    Args:
        annotation: Render annotation.
    Returns:
        Label file content.
    """
    w, h = annotation["image"]["width"], annotation["image"]["height"]
    rows = [(s["class_id"], s["bbox"]) for s in annotation["symbols"]]
    rows += [(CLASS_ID["JUNCTION"], j["bbox"]) for j in annotation["junctions"]]
    lines = []
    for cid, (x1, y1, x2, y2) in rows:
        lines.append(f"{cid} {(x1 + x2) / 2 / w:.6f} {(y1 + y2) / 2 / h:.6f} {(x2 - x1) / w:.6f} {(y2 - y1) / h:.6f}")
    return "\n".join(lines) + "\n"


def generate_sample(seed: int, index: int) -> Sample:
    """
    Generate one sample; depends only on (seed, index).

    Args:
        seed: Global seed.
        index: Sample index.
    Returns:
        The generated Sample.
    """
    rng = np.random.default_rng([seed, index])
    names = [d for d, _ in DOMAIN_WEIGHTS]
    weights = np.array([w for _, w in DOMAIN_WEIGHTS])
    domain = names[int(rng.choice(len(names), p=weights / weights.sum()))]
    while True:
        circuit = sample_circuit(rng, domain)
        topology = topology_hash(circuit)
        split = split_for(topology)
        held_out = split == "test" and bool(rng.random() < HELD_OUT_FRACTION)
        draw_style = sample_draw_style(rng, domain, held_out)
        try:
            layout = build_layout(circuit, draw_style, rng)
        except LayoutError:
            continue
        break
    style = sample_render_style(rng, layout, held_out)
    image, annotation = render(layout, style, rng)
    sample_id = f"{index:06d}"
    annotation = {"id": sample_id, "split": split, "domain": domain, "held_out_style": held_out, **annotation}
    netlist = build_netlist(circuit, annotation, topology)
    return Sample(index, sample_id, split, domain, circuit.recipe, topology, held_out, image, yolo_label(annotation), annotation, netlist)


def _dumps(obj: object) -> bytes:
    """
    Canonical JSON encoding (sorted keys, fixed separators) for reproducible bytes.

    Args:
        obj: JSON-serialisable object.
    Returns:
        UTF-8 bytes with a trailing newline.
    """
    return (json.dumps(obj, sort_keys=True, separators=(",", ":")) + "\n").encode()


def _write(path: Path, data: bytes) -> str:
    """
    Write bytes and return their SHA-256.

    Args:
        path: Destination file.
        data: Content.
    Returns:
        Hex digest.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()


def write_sample(out: Path, sample: Sample) -> dict:
    """
    Write a sample's four files and return its manifest entry.

    Args:
        out: Dataset root.
        sample: Generated sample.
    Returns:
        Manifest entry with relative paths and SHA-256 per file.
    """
    rel = {
        "image": f"images/{sample.split}/{sample.sample_id}.jpg",
        "label": f"labels/{sample.split}/{sample.sample_id}.txt",
        "annotation": f"annotations/{sample.split}/{sample.sample_id}.json",
        "netlist": f"netlists/{sample.split}/{sample.sample_id}.json",
    }
    payloads = {
        "image": sample.image,
        "label": sample.label.encode(),
        "annotation": _dumps(sample.annotation),
        "netlist": _dumps(sample.netlist),
    }
    files = {k: {"path": rel[k], "sha256": _write(out / rel[k], payloads[k])} for k in rel}
    return {
        "id": sample.sample_id,
        "split": sample.split,
        "domain": sample.domain,
        "recipe": sample.recipe,
        "topology_hash": sample.topology,
        "held_out_style": sample.held_out,
        "files": files,
    }


def balance_report(annotations: list[dict]) -> dict:
    """
    Per-domain (and per-split) class instance counts with the 10%-of-max balance rule.

    Args:
        annotations: Annotation dicts (need "domain", "split", "symbols", "junctions").
    Returns:
        Report dict with counts, ratios, pass flags and junction dot size statistics.
    """
    report: dict = {"rule": f"no class under {BALANCE_MIN_RATIO:.0%} of the most frequent class, per domain", "domains": {}}
    for domain, classes in DOMAIN_CLASSES.items():
        subset = [a for a in annotations if a["domain"] == domain]
        counts = Counter()
        per_split: dict[str, Counter] = {s: Counter() for s in SPLITS}
        for a in subset:
            c = Counter(s["class"] for s in a["symbols"])
            c["JUNCTION"] += len(a["junctions"])
            counts.update(c)
            per_split[a["split"]].update(c)
        biggest = max([counts[c] for c in classes] + [1])
        ratios = {c: round(counts[c] / biggest, 4) for c in classes}
        report["domains"][domain] = {
            "images": len(subset),
            "counts": {c: counts[c] for c in classes},
            "ratio_to_max": ratios,
            "passes": all(r >= BALANCE_MIN_RATIO for r in ratios.values()) and bool(subset),
            "per_split": {s: {c: per_split[s][c] for c in classes} for s in SPLITS},
            "images_per_split": {s: sum(1 for a in subset if a["split"] == s) for s in SPLITS},
        }
    dots = [j["diameter"] * 1000.0 / a["image"]["width"] for a in annotations for j in a["junctions"]]
    report["junction_dot_diameter_per_1000px"] = {
        "target": [DOT_MIN_PER_1000, DOT_MAX_PER_1000],
        "count": len(dots),
        "min": round(min(dots), 3) if dots else None,
        "max": round(max(dots), 3) if dots else None,
        "mean": round(float(np.mean(dots)), 3) if dots else None,
    }
    return report


def _worker(args: tuple[int, int]) -> Sample:
    """
    Pool entry point.

    Args:
        args: (seed, index).
    Returns:
        Generated sample.
    """
    return generate_sample(*args)


def _init_worker() -> None:
    """Keep each worker single-threaded (OpenCV and BLAS)."""
    import cv2

    cv2.setNumThreads(1)


def generate_dataset(out: Path, count: int, seed: int, workers: int = 1) -> dict:
    """
    Generate a whole dataset and write manifest.json, balance_report.json and data.yaml.

    Args:
        out: Output root (created).
        count: Number of samples.
        seed: Global seed.
        workers: Worker processes (output does not depend on it).
    Returns:
        The manifest dict.
    """
    out.mkdir(parents=True, exist_ok=True)
    entries: list[dict] = []
    annotations: list[dict] = []
    jobs = [(seed, i) for i in range(count)]

    def consume(sample: Sample) -> None:
        """Write one sample and collect its manifest entry and annotation."""
        entries.append(write_sample(out, sample))
        annotations.append(sample.annotation)

    if workers > 1:
        with Pool(workers, initializer=_init_worker) as pool:
            for sample in pool.imap(_worker, jobs, chunksize=8):
                consume(sample)
    else:
        _init_worker()
        for job in jobs:
            consume(_worker(job))
    manifest = {
        "generator": "backend/data_gen/generate_v2.py",
        "version": GENERATOR_VERSION,
        "seed": seed,
        "count": count,
        "classes": list(TIER_A),
        "schema_version": SCHEMA_VERSION,
        "splits": {s: sum(1 for e in entries if e["split"] == s) for s in SPLITS},
        "held_out_style_samples": sum(1 for e in entries if e["held_out_style"]),
        "samples": entries,
    }
    (out / "manifest.json").write_bytes(_dumps(manifest))
    (out / "balance_report.json").write_bytes(_dumps(balance_report(annotations)))
    (out / "data.yaml").write_text(render_data_yaml(SCHEMA, out))
    return manifest


def main(argv: list[str] | None = None) -> int:
    """
    CLI entry point.

    Args:
        argv: Arguments (defaults to sys.argv).
    Returns:
        Process exit code.
    """
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--count", type=int, default=8000)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--workers", type=int, default=min(4, os.cpu_count() or 1), help="worker processes (default min(4, cpus))")
    args = parser.parse_args(argv)
    manifest = generate_dataset(args.out, args.count, args.seed, args.workers)
    report = json.loads((args.out / "balance_report.json").read_text())
    print(f"wrote {manifest['count']} samples to {args.out}  splits={manifest['splits']}  held_out_style={manifest['held_out_style_samples']}")
    for domain, info in report["domains"].items():
        worst = min(info["ratio_to_max"], key=info["ratio_to_max"].get)
        print(f"  {domain:10s} images={info['images']:5d} passes={info['passes']} min_ratio={info['ratio_to_max'][worst]:.3f} ({worst}) counts={info['counts']}")
    print(f"  junction dot diameter per 1000 px: {report['junction_dot_diameter_per_1000px']}")
    print(f"  manifest sha256: {hashlib.sha256((args.out / 'manifest.json').read_bytes()).hexdigest()}")
    return 0 if all(info["passes"] for info in report["domains"].values()) else 1


if __name__ == "__main__":
    sys.exit(main())
