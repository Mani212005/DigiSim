"""
Module: screenshot_pipeline.py
Purpose: Generates the synthetic hand-drawn-style training dataset for the gate
         detector. Renders random circuit sketches (gates, wires, junctions,
         handwritten distractor text) with pixel-perfect YOLO labels, merges the
         Roboflow hand-drawn dataset (polygon labels converted to bboxes), and
         writes a ready-to-train dataset + data.yaml under ml/dataset/.

Usage:
    cd backend && uv run python data_gen/screenshot_pipeline.py --count 900
"""

import argparse
import shutil
import sys
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from data_gen.symbols import (  # noqa: E402
    CLASS_NAMES,
    CLASS_TO_ID,
    DrawnSymbol,
    draw_symbol,
    hand_stroke,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
ROBOFLOW_DIR = REPO_ROOT / "My First Project.yolov8"

# Roboflow export class ids → canonical CLASS_NAMES ids.
ROBOFLOW_ID_MAP: dict[int, int] = {
    0: CLASS_TO_ID["AND"],  # 'and gate'
    1: CLASS_TO_ID["NAND"],  # 'nand gate'
    2: CLASS_TO_ID["NOR"],  # 'nor gate'
    3: CLASS_TO_ID["NOT"],  # 'not gate'
    4: CLASS_TO_ID["OR"],  # 'or gate'
    5: CLASS_TO_ID["XOR"],  # 'xor gate'
}

GATE_CLASSES = ["AND", "OR", "NOT", "NAND", "NOR", "XOR", "XNOR"]

PEN_COLORS: list[tuple[int, int, int]] = [
    (150, 60, 20),  # blue ballpoint (BGR)
    (140, 40, 40),
    (40, 40, 40),  # black pen
    (60, 60, 60),
    (120, 30, 90),
]

DISTRACTOR_TEXTS = ["A", "B", "C", "D", "Y", "AB", "A+B", "C+D", "AB(C+D)", "X", "Q"]


def _paper_canvas(w: int, h: int, rng: np.random.Generator) -> np.ndarray:
    """
    Create a paper-like background with subtle noise and lighting gradient.

    Args:
        w: Canvas width in pixels.
        h: Canvas height in pixels.
        rng: Random generator.
    Returns:
        HxWx3 uint8 BGR image.
    """
    base = rng.integers(228, 250)
    img = np.full((h, w, 3), base, dtype=np.float64)
    # Soft diagonal lighting gradient.
    gx = np.linspace(0, rng.uniform(-14, 14), w)[None, :, None]
    gy = np.linspace(0, rng.uniform(-14, 14), h)[:, None, None]
    img += gx + gy
    img += rng.normal(0, 2.5, img.shape)
    return np.clip(img, 0, 255).astype(np.uint8)


def _route_wire(
    img: np.ndarray,
    src: tuple[float, float],
    dst: tuple[float, float],
    color: tuple[int, int, int],
    thickness: int,
    rng: np.random.Generator,
) -> tuple[float, float]:
    """
    Draw an orthogonal hand-drawn wire from src to dst.

    Args:
        img: BGR canvas modified in place.
        src: Source (output port) pixel coordinates.
        dst: Destination (input port) pixel coordinates.
        color: BGR pen colour.
        thickness: Stroke thickness.
        rng: Random generator.
    Returns:
        The (x, y) elbow point where the wire turns — used to place junctions.
    """
    mid_x = (src[0] + dst[0]) / 2 + rng.uniform(-12, 12)
    pts = np.array(
        [[src[0], src[1]], [mid_x, src[1]], [mid_x, dst[1]], [dst[0], dst[1]]],
        dtype=np.float64,
    )
    hand_stroke(img, pts, color, thickness, rng, sigma=1.0)
    return (mid_x, src[1])


def _pick_gate(counts: Counter, rng: np.random.Generator) -> str:
    """
    Sample a gate class, biased toward classes with the lowest instance counts.

    Args:
        counts: Global per-class instance counter (mutated by callers).
        rng: Random generator.
    Returns:
        A gate class name.
    """
    max_count = max((counts[g] for g in GATE_CLASSES), default=0) + 1
    weights = np.array(
        [max_count - counts[g] + 1 for g in GATE_CLASSES], dtype=np.float64
    )
    weights /= weights.sum()
    return str(rng.choice(GATE_CLASSES, p=weights))


def generate_circuit_image(
    rng: np.random.Generator, counts: Counter
) -> tuple[np.ndarray, list[tuple[int, tuple[float, float, float, float]]]]:
    """
    Render one synthetic hand-drawn circuit sketch with YOLO annotations.

    Args:
        rng: Random generator.
        counts: Global per-class instance counter, updated with drawn symbols.
    Returns:
        Tuple of (BGR image, list of (class_id, bbox) with pixel-space bboxes).
    """
    w = int(rng.integers(900, 1250))
    h = int(rng.integers(520, 780))
    img = _paper_canvas(w, h, rng)
    color = PEN_COLORS[int(rng.integers(0, len(PEN_COLORS)))]
    thickness = int(rng.integers(2, 4))
    scale = float(rng.uniform(0.65, 1.15))

    symbols: list[DrawnSymbol] = []

    def place(name: str, cx: float, cy: float, s: float) -> DrawnSymbol:
        """Draw one symbol, record its annotation, and return it."""
        sym = draw_symbol(
            img, name, cx, cy, s * rng.uniform(0.88, 1.12), color, thickness, rng
        )
        symbols.append(sym)
        counts[name] += 1
        return sym

    # Sources on the left: INPUT boxes or SWITCH symbols.
    n_src = int(rng.integers(2, 5))
    src_x = rng.uniform(70, 110)
    src_ys = np.linspace(h * 0.18, h * 0.82, n_src) + rng.uniform(-15, 15, n_src)
    sources: list[DrawnSymbol] = []
    for sy in src_ys:
        name = "SWITCH" if rng.random() < 0.30 else "INPUT"
        sources.append(place(name, src_x, float(sy), scale * 0.85))

    # Gate columns left → right.
    n_cols = int(rng.integers(1, 4))
    col_gap = (w - src_x - 260) / max(n_cols, 1)
    prev_layer = sources
    for col in range(n_cols):
        gx = src_x + 190 + col_gap * col + rng.uniform(-20, 20)
        n_gates = int(rng.integers(1, 4)) if col < n_cols - 1 else 1
        gate_ys = np.linspace(h * 0.25, h * 0.75, n_gates) + rng.uniform(
            -20, 20, n_gates
        )
        layer: list[DrawnSymbol] = []
        used: Counter = Counter()
        for gy in gate_ys:
            gate = place(_pick_gate(counts, rng), gx, float(gy), scale)
            layer.append(gate)
            feeders = [s for s in prev_layer if s.out_port is not None]
            k = min(len(gate.in_ports), len(feeders))
            picks = rng.choice(len(feeders), size=k, replace=len(feeders) < k)
            for port, fi in zip(gate.in_ports, picks):
                feeder = feeders[int(fi)]
                elbow = _route_wire(img, feeder.out_port, port, color, thickness, rng)
                used[id(feeder)] += 1
                # A source feeding 2+ gates gets a junction dot at the branch.
                if used[id(feeder)] == 2 and rng.random() < 0.8:
                    place("JUNCTION", elbow[0], elbow[1], scale)
        prev_layer = layer

    # Sink on the right: OUTPUT circle or LED.
    last = prev_layer[0]
    if last.out_port is not None:
        sink_name = "LED" if rng.random() < 0.4 else "OUTPUT"
        sink = place(
            sink_name,
            min(last.out_port[0] + 150, w - 70),
            last.out_port[1],
            scale * 0.85,
        )
        if sink.in_ports:
            _route_wire(img, last.out_port, sink.in_ports[0], color, thickness, rng)

    # Handwritten distractor text (never labelled) — mimics equations in photos.
    for _ in range(int(rng.integers(0, 5))):
        txt = DISTRACTOR_TEXTS[int(rng.integers(0, len(DISTRACTOR_TEXTS)))]
        org = (int(rng.uniform(30, w - 160)), int(rng.uniform(30, h - 20)))
        cv2.putText(
            img,
            txt,
            org,
            cv2.FONT_HERSHEY_SCRIPT_SIMPLEX,
            rng.uniform(0.9, 1.6),
            color,
            2,
            cv2.LINE_AA,
        )

    # Global photo-like degradation: slight blur + sensor noise.
    if rng.random() < 0.6:
        img = cv2.GaussianBlur(img, (3, 3), 0)
    img = np.clip(
        img.astype(np.float64) + rng.normal(0, rng.uniform(1, 5), img.shape),
        0,
        255,
    ).astype(np.uint8)

    annotations = [(CLASS_TO_ID[s.class_name], s.bbox) for s in symbols]
    return img, annotations


def _write_yolo_label(
    path: Path,
    annotations: list[tuple[int, tuple[float, float, float, float]]],
    w: int,
    h: int,
) -> None:
    """
    Write annotations to a YOLO-format .txt label file.

    Args:
        path: Destination label file path.
        annotations: List of (class_id, pixel bbox).
        w: Image width for normalisation.
        h: Image height for normalisation.
    """
    lines = []
    for cls_id, (x1, y1, x2, y2) in annotations:
        x1, x2 = max(0.0, x1), min(float(w), x2)
        y1, y2 = max(0.0, y1), min(float(h), y2)
        if x2 <= x1 or y2 <= y1:
            continue
        cx, cy = (x1 + x2) / 2 / w, (y1 + y2) / 2 / h
        bw, bh = (x2 - x1) / w, (y2 - y1) / h
        lines.append(f"{cls_id} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}")
    path.write_text("\n".join(lines) + "\n")


def _convert_roboflow_split(
    split_src: str, split_dst: str, out_dir: Path, counts: Counter
) -> int:
    """
    Copy one Roboflow split into the merged dataset, converting polygon labels
    to bounding boxes and remapping class ids to the canonical 12-class list.

    Args:
        split_src: Roboflow split directory name ('train', 'valid', 'test').
        split_dst: Destination split name.
        out_dir: Root of the merged dataset.
        counts: Global class counter, updated with converted labels.
    Returns:
        Number of images copied.
    """
    src_images = ROBOFLOW_DIR / split_src / "images"
    src_labels = ROBOFLOW_DIR / split_src / "labels"
    if not src_images.is_dir():
        return 0
    n = 0
    for img_path in sorted(src_images.iterdir()):
        label_path = src_labels / (img_path.stem + ".txt")
        if not label_path.exists():
            continue
        out_lines = []
        for line in label_path.read_text().splitlines():
            parts = line.split()
            if len(parts) < 5:
                continue
            cls_id = ROBOFLOW_ID_MAP.get(int(parts[0]))
            if cls_id is None:
                continue
            coords = np.array([float(v) for v in parts[1:]], dtype=np.float64)
            if len(coords) > 4:  # polygon → bbox
                xs, ys = coords[0::2], coords[1::2]
                x1, x2, y1, y2 = xs.min(), xs.max(), ys.min(), ys.max()
                cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
                bw, bh = x2 - x1, y2 - y1
            else:
                cx, cy, bw, bh = coords
            counts[CLASS_NAMES[cls_id]] += 1
            out_lines.append(f"{cls_id} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}")
        dst_img = out_dir / "images" / split_dst / f"rf_{img_path.name}"
        dst_lbl = out_dir / "labels" / split_dst / f"rf_{img_path.stem}.txt"
        shutil.copy2(img_path, dst_img)
        dst_lbl.write_text("\n".join(out_lines) + "\n")
        n += 1
    return n


def build_dataset(out_dir: Path, count: int, seed: int) -> None:
    """
    Generate the full merged dataset (synthetic + Roboflow) and data.yaml.

    Args:
        out_dir: Dataset root directory (created/overwritten).
        count: Number of synthetic images to generate in total.
        seed: RNG seed for reproducibility.
    """
    rng = np.random.default_rng(seed)
    for split in ("train", "valid", "test"):
        (out_dir / "images" / split).mkdir(parents=True, exist_ok=True)
        (out_dir / "labels" / split).mkdir(parents=True, exist_ok=True)

    counts: Counter = Counter()
    n_valid = max(1, count // 10)
    n_test = max(1, count // 12)
    split_plan = [
        ("train", count - n_valid - n_test),
        ("valid", n_valid),
        ("test", n_test),
    ]
    for split, n in split_plan:
        for i in range(n):
            img, anns = generate_circuit_image(rng, counts)
            name = f"syn_{split}_{i:05d}"
            cv2.imwrite(
                str(out_dir / "images" / split / f"{name}.jpg"),
                img,
                [cv2.IMWRITE_JPEG_QUALITY, int(rng.integers(80, 96))],
            )
            _write_yolo_label(
                out_dir / "labels" / split / f"{name}.txt",
                anns,
                img.shape[1],
                img.shape[0],
            )
        print(f"synthetic {split}: {n} images")

    rf_counts: Counter = Counter()
    for split in ("train", "valid", "test"):
        n = _convert_roboflow_split(split, split, out_dir, rf_counts)
        print(f"roboflow {split}: {n} images merged")
    counts.update(rf_counts)

    yaml_text = (
        f"path: {out_dir.resolve()}\n"
        "train: images/train\n"
        "val: images/valid\n"
        "test: images/test\n"
        f"nc: {len(CLASS_NAMES)}\n"
        f"names: {CLASS_NAMES}\n"
    )
    (out_dir / "data.yaml").write_text(yaml_text)

    total = sum(counts.values())
    max_count = max(counts.values())
    print("\nClass balance (instances):")
    for name in CLASS_NAMES:
        share = counts[name] / total * 100 if total else 0.0
        flag = "  ⚠ under 10% of max" if counts[name] < 0.10 * max_count else ""
        print(f"  {name:<9} {counts[name]:>6}  ({share:4.1f}%){flag}")
    print(f"\nDataset written to {out_dir.resolve()}")


def main() -> None:
    """
    CLI entry point.

    Raises:
        SystemExit: On argparse errors.
    """
    parser = argparse.ArgumentParser(description="Generate DigiSim gate dataset")
    parser.add_argument("--count", type=int, default=900, help="synthetic images")
    parser.add_argument("--seed", type=int, default=42, help="RNG seed")
    parser.add_argument(
        "--out",
        type=Path,
        default=REPO_ROOT / "ml" / "dataset",
        help="output dataset root",
    )
    args = parser.parse_args()
    build_dataset(args.out, args.count, args.seed)


if __name__ == "__main__":
    main()
