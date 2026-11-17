"""
Module: contact_sheet.py
Purpose: Visual QA for the v2 synthetic dataset. Draws every label of a sample on its image
         (class boxes, pin points with terminal names, junction boxes, crossings) and tiles
         randomly chosen overlays into one contact sheet JPEG, so a reviewer can check that
         boxes, pins and dots match the drawing.

Usage:
    cd backend && uv run python data_gen/synth_v2/contact_sheet.py --data DIR --out sheet.jpg --samples 50 --seed 1
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

# One distinct BGR colour per tier-A class (index = YOLO id).
PALETTE: tuple[tuple[int, int, int], ...] = (
    (40, 40, 230),
    (230, 60, 40),
    (0, 140, 255),
    (120, 80, 0),
    (0, 170, 0),
    (170, 0, 170),
    (0, 0, 0),
    (200, 120, 0),
    (0, 120, 200),
    (120, 0, 200),
    (60, 160, 160),
    (160, 60, 120),
    (90, 90, 200),
    (40, 120, 90),
)


def overlay(image: np.ndarray, annotation: dict) -> np.ndarray:
    """
    Draw labels of one sample onto a copy of its image.

    Args:
        image: BGR image.
        annotation: Annotation JSON of the sample.
    Returns:
        Annotated BGR image.
    """
    out = image.copy()
    scale = max(1, round(image.shape[1] / 900))
    for sym in annotation["symbols"]:
        color = PALETTE[sym["class_id"] % len(PALETTE)]
        x1, y1, x2, y2 = (int(round(v)) for v in sym["bbox"])
        cv2.rectangle(out, (x1, y1), (x2, y2), color, scale)
        cv2.putText(out, sym["class"], (x1, max(10, y1 - 3)), cv2.FONT_HERSHEY_SIMPLEX, 0.4 * scale, color, scale, cv2.LINE_AA)
        for term, (px, py) in sym["pins"].items():
            cv2.circle(out, (int(round(px)), int(round(py))), 3 * scale, (0, 200, 255), -1, cv2.LINE_AA)
            cv2.putText(out, term, (int(px) + 4, int(py) - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.35 * scale, (0, 120, 255), scale, cv2.LINE_AA)
    for j in annotation["junctions"]:
        x1, y1, x2, y2 = (int(round(v)) for v in j["bbox"])
        cv2.rectangle(out, (x1 - 1, y1 - 1), (x2 + 1, y2 + 1), (0, 0, 255), scale)
    for c in annotation["crossings"]:
        x, y = (int(round(v)) for v in c["point"])
        cv2.drawMarker(out, (x, y), (255, 0, 255), cv2.MARKER_TILTED_CROSS, 8 * scale, scale)
    return out


def contact_sheet(data: Path, out: Path, samples: int, seed: int, cols: int = 5, tile_w: int = 420) -> list[str]:
    """
    Tile overlays of randomly chosen samples into one JPEG.

    Args:
        data: Dataset root (with manifest.json).
        out: Output JPEG path.
        samples: Number of samples to show.
        seed: Selection seed.
        cols: Tiles per row.
        tile_w: Tile width in pixels.
    Returns:
        IDs of the samples shown.
    """
    manifest = json.loads((data / "manifest.json").read_text())
    entries = manifest["samples"]
    rng = np.random.default_rng(seed)
    chosen = sorted(rng.choice(len(entries), size=min(samples, len(entries)), replace=False).tolist())
    tiles: list[np.ndarray] = []
    for i in chosen:
        e = entries[i]
        img = cv2.imread(str(data / e["files"]["image"]["path"]))
        ann = json.loads((data / e["files"]["annotation"]["path"]).read_text())
        ov = overlay(img, ann)
        # Fit into a square tile so tall (rotated) drawings do not stretch the sheet.
        scale = min(tile_w / ov.shape[1], tile_w / ov.shape[0])
        fw, fh = max(1, int(round(ov.shape[1] * scale))), max(1, int(round(ov.shape[0] * scale)))
        fitted = cv2.resize(ov, (fw, fh), interpolation=cv2.INTER_AREA)
        tile = np.full((tile_w, tile_w, 3), 235, dtype=np.uint8)
        y0, x0 = (tile_w - fh) // 2, (tile_w - fw) // 2
        tile[y0 : y0 + fh, x0 : x0 + fw] = fitted
        caption = f"{e['id']} {e['split']} {e['domain']} {e['recipe']} {ann['render_style']['mode']}{' HELD-OUT' if e['held_out_style'] else ''}"
        bar = np.full((18, tile_w, 3), 255, dtype=np.uint8)
        cv2.putText(bar, caption, (4, 13), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 0, 0), 1, cv2.LINE_AA)
        tiles.append(np.vstack([bar, tile]))
    rows = []
    for r in range(0, len(tiles), cols):
        row_tiles = tiles[r : r + cols]
        row_h = max(t.shape[0] for t in row_tiles)
        padded = [np.vstack([t, np.full((row_h - t.shape[0], tile_w, 3), 235, dtype=np.uint8)]) for t in row_tiles]
        padded += [np.full((row_h, tile_w, 3), 235, dtype=np.uint8)] * (cols - len(row_tiles))
        rows.append(np.hstack([np.pad(t, ((2, 2), (2, 2), (0, 0)), constant_values=200) for t in padded]))
    sheet = np.vstack(rows)
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), sheet, [cv2.IMWRITE_JPEG_QUALITY, 82])
    return [entries[i]["id"] for i in chosen]


def main(argv: list[str] | None = None) -> int:
    """
    CLI entry point.

    Args:
        argv: Arguments (defaults to sys.argv).
    Returns:
        Process exit code.
    """
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--samples", type=int, default=50)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--cols", type=int, default=5)
    parser.add_argument("--tile-width", type=int, default=420)
    args = parser.parse_args(argv)
    ids = contact_sheet(args.data, args.out, args.samples, args.seed, args.cols, args.tile_width)
    print(f"wrote {args.out} with {len(ids)} samples")
    return 0


if __name__ == "__main__":
    sys.exit(main())
