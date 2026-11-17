"""
Module: test_generate_v2.py
Purpose: Acceptance tests for the v2 synthetic generator (backend/data_gen/generate_v2.py):
         byte-identical manifests for a fixed seed regardless of worker count, YOLO label
         bounds, no empty images, per-domain class balance, junction dot sizes, drawn wires
         that connect exactly the netlist pins, topology-hash splits with held-out styles only
         in test, and a 100% truth-table check of every netlist against DigiSim's switch-level
         solver (frontend/scripts/verifySynthNetlists.js, run with node).
"""

import json
import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np
import pytest

from data_gen.generate_v2 import DOMAIN_CLASSES, balance_report, generate_dataset
from data_gen.synth_v2.render import DOT_MAX_PER_1000, DOT_MIN_PER_1000, HELD_OUT_FONT, HELD_OUT_LINE, HELD_OUT_PAPER
from data_gen.synth_v2.schema import TIER_A
from data_gen.synth_v2.symbols import compose_orientation, orient_grid

REPO_ROOT = Path(__file__).resolve().parent.parent
VERIFY_SCRIPT = REPO_ROOT / "frontend" / "scripts" / "verifySynthNetlists.js"
DATASET_COUNT = 240


@pytest.fixture(scope="module")
def dataset(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """
    Generate one small dataset shared by the tests in this module.

    Args:
        tmp_path_factory: Pytest temp dir factory.
    Returns:
        Dataset root.
    """
    root = tmp_path_factory.mktemp("synth_v2")
    generate_dataset(root, DATASET_COUNT, seed=3, workers=4)
    return root


def _entries(root: Path) -> list[dict]:
    """
    Manifest sample entries.

    Args:
        root: Dataset root.
    Returns:
        List of manifest entries.
    """
    return json.loads((root / "manifest.json").read_text())["samples"]


def _annotation(root: Path, entry: dict) -> dict:
    """
    Load a sample's annotation JSON.

    Args:
        root: Dataset root.
        entry: Manifest entry.
    Returns:
        Annotation dict.
    """
    return json.loads((root / entry["files"]["annotation"]["path"]).read_text())


def test_manifest_byte_identical_across_runs_and_workers(tmp_path: Path) -> None:
    """Same seed gives the same manifest bytes, independent of the worker count."""
    generate_dataset(tmp_path / "a", 24, seed=11, workers=1)
    generate_dataset(tmp_path / "b", 24, seed=11, workers=3)
    assert (tmp_path / "a" / "manifest.json").read_bytes() == (tmp_path / "b" / "manifest.json").read_bytes()
    generate_dataset(tmp_path / "c", 24, seed=12, workers=1)
    assert (tmp_path / "a" / "manifest.json").read_bytes() != (tmp_path / "c" / "manifest.json").read_bytes()


def test_manifest_hashes_match_files(dataset: Path) -> None:
    """Every file listed in the manifest exists and matches its SHA-256."""
    import hashlib

    entries = _entries(dataset)
    assert len(entries) == DATASET_COUNT
    for e in entries:
        for f in e["files"].values():
            assert hashlib.sha256((dataset / f["path"]).read_bytes()).hexdigest() == f["sha256"]


def test_label_bounds_and_counts(dataset: Path) -> None:
    """YOLO labels use tier-A ids, are normalised inside the image, and match the annotation."""
    for e in _entries(dataset):
        ann = _annotation(dataset, e)
        w, h = ann["image"]["width"], ann["image"]["height"]
        lines = (dataset / e["files"]["label"]["path"]).read_text().splitlines()
        assert len(lines) == len(ann["symbols"]) + len(ann["junctions"]) > 0
        for line in lines:
            cid, cx, cy, bw, bh = line.split()
            assert 0 <= int(cid) < len(TIER_A)
            cx, cy, bw, bh = float(cx), float(cy), float(bw), float(bh)
            assert 0 < bw <= 1 and 0 < bh <= 1
            assert 0 <= cx - bw / 2 + 1e-6 and cx + bw / 2 <= 1 + 1e-6
            assert 0 <= cy - bh / 2 + 1e-6 and cy + bh / 2 <= 1 + 1e-6
        for sym in ann["symbols"]:
            x1, y1, x2, y2 = sym["bbox"]
            assert x2 - x1 > 3 and y2 - y1 > 3
            for px, py in sym["pins"].values():
                assert 0 <= px <= w and 0 <= py <= h
                # Pins sit on the lead ends, i.e. on (or within a few px of) the box boundary.
                assert x1 - 1 <= px <= x2 + 1 and y1 - 1 <= py <= y2 + 1


def test_no_empty_images(dataset: Path) -> None:
    """Every image decodes, matches the annotated size and contains ink."""
    for e in _entries(dataset):
        ann = _annotation(dataset, e)
        img = cv2.imread(str(dataset / e["files"]["image"]["path"]), cv2.IMREAD_GRAYSCALE)
        assert img is not None
        assert img.shape == (ann["image"]["height"], ann["image"]["width"])
        background = float(np.median(img))
        assert float((img < background - 60).mean()) > 0.003, e["id"]


def test_class_balance_per_domain(dataset: Path) -> None:
    """Within each domain no class falls under 10% of the most frequent class."""
    report = json.loads((dataset / "balance_report.json").read_text())
    for domain in DOMAIN_CLASSES:
        info = report["domains"][domain]
        assert info["images"] > 0
        assert info["passes"], (domain, info["ratio_to_max"])


def test_balance_report_flags_imbalance() -> None:
    """The balance check fails when a class is rare."""
    rare = [{"class": c} for c in DOMAIN_CLASSES["gate"] if c not in ("AND", "JUNCTION")]
    ann = {"domain": "gate", "split": "train", "image": {"width": 1000}, "junctions": [], "symbols": [{"class": "AND"}] * 20 + rare}
    assert not balance_report([ann])["domains"]["gate"]["passes"]


def test_junction_dot_size_matches_real(dataset: Path) -> None:
    """Junction dot diameter is 10-17 px at 1000 px image width."""
    dots = [j["diameter"] * 1000 / _annotation(dataset, e)["image"]["width"] for e in _entries(dataset) for j in _annotation(dataset, e)["junctions"]]
    assert dots
    assert DOT_MIN_PER_1000 - 0.05 <= min(dots) and max(dots) <= DOT_MAX_PER_1000 + 0.05


def test_wires_connect_exactly_the_netlist_pins(dataset: Path) -> None:
    """Each pin is a wire end of its own net, and each drawn net is one connected tree."""
    for e in _entries(dataset):
        ann = _annotation(dataset, e)
        parent: dict[tuple, tuple] = {}

        def find(k: tuple) -> tuple:
            """Union-find root."""
            while parent.setdefault(k, k) != k:
                k = parent[k]
            return k

        ends: dict[tuple, str] = {}
        for wire in ann["wires"]:
            pts = [(wire["net"], round(x, 1), round(y, 1)) for x, y in wire["points"]]
            for a, b in zip(pts[:-1], pts[1:]):
                parent[find(a)] = find(b)
            for p in (pts[0], pts[-1]):
                ends[p[1:]] = wire["net"]
        net_roots: dict[str, set] = {}
        for sym in ann["symbols"]:
            for term, (px, py) in sym["pins"].items():
                key = (round(px, 1), round(py, 1))
                net = sym["nets"][term]
                assert ends.get(key) == net, (e["id"], sym["id"], term)
                if net not in ("VDD", "GND"):
                    net_roots.setdefault(net, set()).add(find((net, *key)))
        for j in ann["junctions"]:
            assert (round(j["center"][0], 1), round(j["center"][1], 1)) in ends, (e["id"], j)
        for net, roots in net_roots.items():
            assert len(roots) == 1, (e["id"], net)


def test_topology_splits_and_held_out_styles(dataset: Path) -> None:
    """A topology lives in one split only; held-out style values appear only in held-out test samples."""
    split_of: dict[str, str] = {}
    for e in _entries(dataset):
        assert split_of.setdefault(e["topology_hash"], e["split"]) == e["split"]
        style = _annotation(dataset, e)["render_style"]
        uses_held_out = style["font"] == HELD_OUT_FONT or style["paper"] == HELD_OUT_PAPER or style["line"] == HELD_OUT_LINE
        if e["held_out_style"]:
            assert e["split"] == "test" and style["font"] == HELD_OUT_FONT and style["paper"] == HELD_OUT_PAPER
        else:
            assert not uses_held_out, e["id"]
        if any(s["class"] == "VDD" and s["variant"] == "circle" for s in _annotation(dataset, e)["symbols"]):
            assert e["held_out_style"]
    assert {e["split"] for e in _entries(dataset)} == {"train", "valid", "test"}


def test_orientation_composition() -> None:
    """compose_orientation equals applying the two orientations in sequence."""
    for r1 in (0, 90, 180, 270):
        for m1 in (False, True):
            for r2 in (0, 90, 180, 270):
                for m2 in (False, True):
                    r, m = compose_orientation((r1, m1), (r2, m2))
                    for p in ((2, 1), (-1, 3)):
                        assert orient_grid(orient_grid(p, r1, m1), r2, m2) == orient_grid(p, r, m)


def _run_verifier(root: Path) -> subprocess.CompletedProcess:
    """
    Run the node switch-level verifier on a dataset.

    Args:
        root: Dataset root.
    Returns:
        Completed process.
    """
    return subprocess.run(["node", str(VERIFY_SCRIPT), str(root)], capture_output=True, text=True, timeout=600, check=False)


needs_node = pytest.mark.skipif(
    shutil.which("node") is None or not (REPO_ROOT / "frontend" / "node_modules" / "typescript").exists(),
    reason="needs node and frontend/node_modules (cd frontend && npm install)",
)


@needs_node
def test_all_netlists_pass_switch_level_truth_table(dataset: Path) -> None:
    """100% of generated netlists reproduce their truth table in DigiSim's switch-level solver."""
    result = _run_verifier(dataset)
    assert result.returncode == 0, result.stdout + result.stderr
    assert f"{DATASET_COUNT}/{DATASET_COUNT} netlists pass" in result.stdout


@needs_node
def test_verifier_catches_a_broken_netlist(dataset: Path, tmp_path: Path) -> None:
    """Swapping a transistor gate to the wrong net makes the verifier fail."""
    entry = next(e for e in _entries(dataset) if e["domain"] == "transistor")
    netlist = json.loads((dataset / entry["files"]["netlist"]["path"]).read_text())
    mos = next(c for c in netlist["components"] if c["class"] == "NMOS")
    mos["pins"]["g"] = "VDD"
    (tmp_path / "x.json").write_text(json.dumps(netlist))
    result = _run_verifier(tmp_path)
    assert result.returncode == 1
    assert "0/1 netlists pass" in result.stdout
