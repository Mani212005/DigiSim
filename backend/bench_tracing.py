"""
Module: bench_tracing.py
Purpose: Benchmark for net tracing v2 (T8). Runs the classical net tracer on synthetic samples
         from the T2 generator (backend/data_gen/generate_v2.py) driven by ground-truth
         detections with realistic perturbation (box jitter, keypoint jitter, missed junction
         dots), then scores the exported netlists with the T6 evaluation harness
         (ml/eval_netlist.py): net precision/recall/F1 over pin pairs and netlist exact match,
         split into clean renders (cad, textbook) and hand-drawn-style renders (hand, photo).
         Also reports per-image runtime, orientation-head accuracy, MOSFET drain/source accuracy
         and port-label accuracy (over ports whose name is drawn in the image). No trained weights are needed; the same tracer runs unchanged
         on real detector output (T7).

Usage:
    cd backend
    uv run python data_gen/generate_v2.py --count 300 --seed 1 --out /tmp/synth300
    uv run python bench_tracing.py --data /tmp/synth300 --count 300 --out /tmp/bench --mode both
Exit code: 0 when the acceptance gates pass (net F1 >= 0.90 on both styles, exact match >= 70% clean
and >= 50% hand-drawn) for every evaluated pin mode, 1 otherwise.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))
sys.path.insert(0, str(BACKEND_DIR.parent / "ml"))

from eval_netlist import evaluate_netlists  # noqa: E402

from pipeline.circuit_exporter import CircuitExporter  # noqa: E402
from pipeline.detector import Detection  # noqa: E402
from pipeline.graph_builder import GraphBuilder  # noqa: E402
from pipeline.label_attach import rapidocr_recognizer  # noqa: E402
from pipeline.net_tracer import NetTracer  # noqa: E402
from pipeline.pin_assignment import CANONICAL_PINS, orient_vector  # noqa: E402
from pipeline.trace_types import Orientation, TextBox  # noqa: E402

CLEAN_MODES = ("cad", "textbook")
HAND_MODES = ("hand", "photo")
DOMAIN_RULES: tuple[tuple[str, str], ...] = (("cad_", "clean"), ("textbook_", "clean"), ("hand_", "hand_drawn"), ("photo_", "hand_drawn"))
GATES = {"clean": {"net_f1": 0.90, "exact_match": 0.70}, "hand_drawn": {"net_f1": 0.90, "exact_match": 0.50}}
RUNTIME_LIMIT_S = 2.0
MIRROR_SYMMETRIC = frozenset({"VDD", "GND", "INPUT_PORT", "OUTPUT_PORT", "NOT"})


@dataclass(frozen=True)
class Perturbation:
    """How ground-truth detections are degraded to look like detector output."""

    box_sigma: float = 0.03  # each box edge moves by N(0, sigma * box side)
    keypoint_sigma: float = 0.03  # keypoints move by N(0, sigma * short box side) per axis
    junction_miss: float = 0.02  # probability a junction dot is not detected
    junction_sigma: float = 0.1  # junction box edges move by N(0, sigma * dot diameter)


def perturb_detections(annotation: dict, rng: np.random.Generator, p: Perturbation, keypoints: bool) -> list[Detection]:
    """
    Build detector-like detections from a T2 annotation.

    Args:
        annotation: T2 annotation (symbols with bbox/pins, junctions with bbox).
        rng: Random generator.
        p: Perturbation settings.
        keypoints: Attach (jittered) pin keypoints, as a pose head would.
    Returns:
        Detections: symbols first (annotation order), then the junctions that were not dropped.
    """
    dets: list[Detection] = []
    for sym in annotation["symbols"]:
        x1, y1, x2, y2 = sym["bbox"]
        w, h = x2 - x1, y2 - y1
        x1, x2 = x1 + rng.normal(0, p.box_sigma * w), x2 + rng.normal(0, p.box_sigma * w)
        y1, y2 = y1 + rng.normal(0, p.box_sigma * h), y2 + rng.normal(0, p.box_sigma * h)
        kps = None
        if keypoints:
            s = p.keypoint_sigma * min(w, h)
            kps = {t: (float(xy[0] + rng.normal(0, s)), float(xy[1] + rng.normal(0, s))) for t, xy in sym["pins"].items()}
        dets.append(Detection(sym["class"], float(rng.uniform(0.6, 0.99)), (x1 + x2) / 2, (y1 + y2) / 2, abs(x2 - x1), abs(y2 - y1), keypoints=kps))
    for j in annotation["junctions"]:
        if rng.random() < p.junction_miss:
            continue
        x1, y1, x2, y2 = j["bbox"]
        d = p.junction_sigma * j["diameter"]
        x1, x2, y1, y2 = (v + rng.normal(0, d) for v in (x1, x2, y1, y2))
        dets.append(Detection("JUNCTION", float(rng.uniform(0.6, 0.99)), (x1 + x2) / 2, (y1 + y2) / 2, abs(x2 - x1), abs(y2 - y1)))
    return dets


def ground_truth_netlist(netlist: dict, annotation: dict) -> dict:
    """
    T2 netlist in the evaluator's nets-of-pins schema, with ground-truth boxes for component pairing.

    Args:
        netlist: T2 netlist.json.
        annotation: T2 annotation (symbol boxes by id).
    Returns:
        {"components": [{"id", "type", "bbox"}], "nets": [[pins]]}.
    """
    boxes = {s["id"]: s["bbox"] for s in annotation["symbols"]}
    by_net: dict[str, list[str]] = {}
    comps = []
    for c in netlist["components"]:
        comps.append({"id": c["id"], "type": c["node_type"], "bbox": boxes[c["id"]]})
        for t, n in c["pins"].items():
            by_net.setdefault(n, []).append(f"{c['id']}:{t}")
    return {"components": comps, "nets": [sorted(v) for _, v in sorted(by_net.items())]}


def _orientation_ok(cls: str, pred: dict | None, truth: dict) -> bool:
    """
    Whether a predicted orientation matches ground truth, modulo the symbol's own symmetry.

    Args:
        cls: Class name.
        pred: Exported orientation dict or None.
        truth: Annotation orientation {"rotation", "mirror"}.
    Returns:
        True when the orientations are equivalent for this symbol.
    """
    if pred is None:
        return False
    if cls in MIRROR_SYMMETRIC:
        # A mirror-symmetric symbol is fixed by the direction of its pin axis alone.
        return _pin_axis(cls, pred) == _pin_axis(cls, truth)
    return pred["rotation"] == truth["rotation"] and pred["mirror"] == truth["mirror"]


def _pin_axis(cls: str, o: dict) -> tuple[int, int]:
    """
    Screen direction of a mirror-symmetric symbol's canonical pin axis under an orientation.

    Args:
        cls: Class name.
        o: Orientation {"rotation", "mirror"}.
    Returns:
        Rounded unit direction (dx, dy).
    """
    v = orient_vector(CANONICAL_PINS[cls][next(iter(CANONICAL_PINS[cls]))], Orientation(int(o["rotation"]), bool(o["mirror"])))
    return (int(np.sign(round(v[0], 6))), int(np.sign(round(v[1], 6))))


def run_mode(samples: list[dict], data: Path, out: Path, mode: str, perturb: Perturbation, seed: int, ocr: str, truth_table: bool) -> dict:
    """
    Trace every sample in one pin mode and score it.

    Args:
        samples: Manifest entries.
        data: T2 dataset root.
        out: Output directory for this mode (gt/, pred/, report).
        mode: "keypoints" or "geometry".
        perturb: Perturbation settings.
        seed: Perturbation seed.
        ocr: "gt" (annotation texts), "rapidocr" or "none".
        truth_table: Also run truth-table equivalence through DigiSim's simulator.
    Returns:
        Summary dict.
    """
    gt_dir, pred_dir = out / "gt", out / "pred"
    for d in (gt_dir, pred_dir):
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
    tracer = NetTracer(ocr=rapidocr_recognizer if ocr == "rapidocr" else None)
    times: list[float] = []
    orient = {"ok": 0, "n": 0}
    ds = {"ok": 0, "n": 0}
    labels = {"ok": 0, "n": 0}
    per_sample: dict[str, dict] = {}
    for entry in samples:
        ann = json.loads((data / entry["files"]["annotation"]["path"]).read_text())
        net = json.loads((data / entry["files"]["netlist"]["path"]).read_text())
        image = cv2.imread(str(data / entry["files"]["image"]["path"]))
        rng = np.random.default_rng([seed, int(entry["id"])])
        dets = perturb_detections(ann, rng, perturb, keypoints=(mode == "keypoints"))
        texts = [TextBox(t["text"], tuple(t["bbox"])) for t in ann["texts"]] if ocr == "gt" else None
        t0 = time.perf_counter()
        trace = tracer.trace(image, dets, texts=texts)
        payload = CircuitExporter().export(GraphBuilder().build(trace))
        times.append(time.perf_counter() - t0)
        stem = f"{ann['render_style']['mode']}_{entry['id']}"
        (gt_dir / f"{stem}.json").write_text(json.dumps(ground_truth_netlist(net, ann)))
        (pred_dir / f"{stem}.json").write_text(json.dumps(payload))
        per_sample[stem] = {"seconds": round(times[-1], 4), "diagnostics": trace.diagnostics.__dict__}
        id_map = {comp["id"]: sym["id"] for sym, comp in zip(ann["symbols"], payload["components"])}
        gt_pin_net = {f"{sym['id']}:{t}": n for sym in ann["symbols"] for t, n in sym["nets"].items()}
        pred_net_pins = {n["id"]: n["pins"] for n in payload["nets"]}
        drawn = {t["text"] for t in ann["texts"]}
        for sym, comp in zip(ann["symbols"], payload["components"]):
            ok = _orientation_ok(sym["class"], comp["orientation"], sym["orientation"])
            orient["n"] += 1
            orient["ok"] += int(ok)
            if sym["class"] in ("NMOS", "PMOS") and all(comp["pins"].get(t, {}).get("net") for t in ("d", "s")):
                ds["n"] += 1
                own = {f"{comp['id']}:d", f"{comp['id']}:s"}
                got = {t: _majority_gt_net(pred_net_pins[comp["pins"][t]["net"]], own, id_map, gt_pin_net) for t in ("d", "s")}
                ds["ok"] += int(got["d"] == sym["nets"]["d"] and got["s"] == sym["nets"]["s"])
            name = next(iter(sym["nets"].values()))
            if sym["class"] in ("INPUT_PORT", "OUTPUT_PORT") and name in drawn:
                labels["n"] += 1
                labels["ok"] += int(comp["label"] == name)
    report = evaluate_netlists(gt_dir, pred_dir, truth_table=truth_table, domain_rules=DOMAIN_RULES)
    arr = np.array(times)
    summary = {
        "mode": mode,
        "samples": len(samples),
        "runtime_s": {"mean": round(float(arr.mean()), 4), "p95": round(float(np.percentile(arr, 95)), 4), "max": round(float(arr.max()), 4)},
        "orientation_accuracy": round(orient["ok"] / orient["n"], 4) if orient["n"] else None,
        "mosfet_ds_accuracy": round(ds["ok"] / ds["n"], 4) if ds["n"] else None,
        "port_label_accuracy": round(labels["ok"] / labels["n"], 4) if labels["n"] and ocr != "none" else None,
        "overall": report["overall"],
        "per_domain": report["per_domain"],
        "per_render_mode": _per_render_mode(report["circuits"]),
    }
    (out / "report.json").write_text(json.dumps({"summary": summary, "evaluation": report, "per_sample": per_sample}, indent=1, default=str))
    return summary


def _majority_gt_net(pins: list[str], exclude: set[str], id_map: dict[str, str], gt_pin_net: dict[str, str]) -> str | None:
    """
    Ground-truth net most of a predicted net's pins belong to.

    Args:
        pins: Pins of the predicted net (predicted component ids).
        exclude: Pins to ignore (the transistor's own channel pins).
        id_map: Predicted component id -> ground-truth component id.
        gt_pin_net: Ground-truth "<id>:<terminal>" -> net name.
    Returns:
        The majority ground-truth net name, or None when no pin maps.
    """
    votes = Counter(gt_pin_net.get(f"{id_map[p.partition(':')[0]]}:{p.partition(':')[2]}") for p in pins if p not in exclude)
    votes.pop(None, None)
    return votes.most_common(1)[0][0] if votes else None


def _per_render_mode(circuits: dict[str, dict]) -> dict[str, dict]:
    """
    Net F1 and exact-match rate per render mode, from the evaluator's per-circuit records.

    Args:
        circuits: evaluate_netlists()["circuits"].
    Returns:
        Mode -> {circuits, net_f1, exact_match}.
    """
    acc: dict[str, dict[str, float]] = {}
    for stem, rec in circuits.items():
        m = stem.split("_")[0]
        a = acc.setdefault(m, {"n": 0, "tp": 0, "fp": 0, "fn": 0, "exact": 0})
        a["n"] += 1
        a["exact"] += int(rec["exact_match"])
        for k in ("tp", "fp", "fn"):
            a[k] += rec["pairs"][k]
    return {
        m: {
            "circuits": int(a["n"]),
            "net_f1": round(2 * a["tp"] / max(1, 2 * a["tp"] + a["fp"] + a["fn"]), 4),
            "exact_match": round(a["exact"] / a["n"], 4),
        }
        for m, a in sorted(acc.items())
    }


def gates_pass(summary: dict) -> bool:
    """
    Whether a mode's summary meets the T8 acceptance gates.

    Args:
        summary: run_mode() summary.
    Returns:
        True when every domain gate and the runtime limit pass.
    """
    for domain, gate in GATES.items():
        d = summary["per_domain"].get(domain)
        if d is None or (d["net_micro"]["f1"] or 0.0) < gate["net_f1"] or d["exact_match"]["value"] < gate["exact_match"]:
            return False
    return summary["runtime_s"]["p95"] < RUNTIME_LIMIT_S


def markdown(summaries: list[dict], perturb: Perturbation) -> str:
    """
    Markdown table of the bench results.

    Args:
        summaries: Per-mode summaries.
        perturb: Perturbation used.
    Returns:
        Markdown text.
    """
    lines = [
        "# Net tracing v2 bench",
        "",
        f"Perturbation: {perturb}",
        "",
        "| pin mode | domain | circuits | net P | net R | net F1 | exact match | truth-table equiv. | gate |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for s in summaries:
        for domain, d in sorted(s["per_domain"].items()):
            nm = d["net_micro"]
            gate = GATES.get(domain, {})
            ok = (nm["f1"] or 0) >= gate.get("net_f1", 0) and d["exact_match"]["value"] >= gate.get("exact_match", 0)
            tt = d["truth_table"]["value"]
            tt_text = "n/a" if tt is None else f"{tt:.3f}"
            lines.append(
                f"| {s['mode']} | {domain} | {d['circuits']} | {nm['precision']:.4f} | {nm['recall']:.4f} | {nm['f1']:.4f} | {d['exact_match']['value']:.3f} | {tt_text} | {'pass' if ok else 'FAIL'} |"
            )
    lines += ["", "| pin mode | render mode | circuits | net F1 | exact match |", "|---|---|---|---|---|"]
    for s in summaries:
        for m, d in s["per_render_mode"].items():
            lines.append(f"| {s['mode']} | {m} | {d['circuits']} | {d['net_f1']:.4f} | {d['exact_match']:.3f} |")
    lines += ["", "| pin mode | runtime mean / p95 / max (s) | orientation acc | MOSFET d/s acc | port label acc |", "|---|---|---|---|---|"]
    for s in summaries:
        r = s["runtime_s"]
        lines.append(f"| {s['mode']} | {r['mean']} / {r['p95']} / {r['max']} | {s['orientation_accuracy']} | {s['mosfet_ds_accuracy']} | {s['port_label_accuracy']} |")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    """
    CLI entry point.

    Args:
        argv: Arguments (defaults to sys.argv).
    Returns:
        0 when every evaluated mode passes the gates, else 1.
    """
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, required=True, help="T2 dataset root (has manifest.json)")
    parser.add_argument("--count", type=int, default=300, help="samples to evaluate (first N of the manifest)")
    parser.add_argument("--out", type=Path, default=BACKEND_DIR.parent / "ml" / "experiments" / "trace_bench")
    parser.add_argument("--mode", choices=("keypoints", "geometry", "both"), default="both")
    parser.add_argument("--seed", type=int, default=0, help="perturbation seed")
    parser.add_argument("--ocr", choices=("gt", "rapidocr", "none"), default="gt", help="text source for label attachment")
    parser.add_argument("--truth-table", action="store_true", help="also check truth-table equivalence (needs node + frontend deps)")
    parser.add_argument("--box-sigma", type=float, default=Perturbation.box_sigma)
    parser.add_argument("--keypoint-sigma", type=float, default=Perturbation.keypoint_sigma)
    parser.add_argument("--junction-miss", type=float, default=Perturbation.junction_miss)
    args = parser.parse_args(argv)
    cv2.setNumThreads(1)
    manifest = json.loads((args.data / "manifest.json").read_text())
    samples = sorted(manifest["samples"], key=lambda e: e["id"])[: args.count]
    perturb = Perturbation(box_sigma=args.box_sigma, keypoint_sigma=args.keypoint_sigma, junction_miss=args.junction_miss)
    modes = ("keypoints", "geometry") if args.mode == "both" else (args.mode,)
    summaries = [run_mode(samples, args.data, args.out / m, m, perturb, args.seed, args.ocr, args.truth_table) for m in modes]
    md = markdown(summaries, perturb)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "report.md").write_text(md)
    print(md)
    return 0 if all(gates_pass(s) for s in summaries) else 1


if __name__ == "__main__":
    sys.exit(main())
