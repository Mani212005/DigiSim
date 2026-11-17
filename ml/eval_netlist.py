"""
Module: eval_netlist.py
Purpose: End-to-end (image -> circuit) metrics for the evaluation harness. Compares a predicted
         netlist with the ground-truth netlist of the same image: net precision/recall/F1 over
         pin-pair connectivity, netlist exact-match rate, and truth-table equivalence after the
         predicted circuit is rebuilt as a DigiSim canvas and simulated by DigiSim's own simulator
         (frontend/src/logic/simulation, driven through ml/sim_bridge/truth_table.cjs).

Netlist JSON schema (ground truth and predictions use the same shape; T2 emits it, T8 will emit it):
    {
      "components": [{"id": "MP1", "type": "pmos", "bbox": [x1, y1, x2, y2]}, ...],
      "nets": [["MP1:d", "MN1:d", "Y:a"], ["IN:out", "MP1:g", "MN1:g"], ...]
    }
    - type is a frontend node type from ml/classes.yaml (nmos, pmos, vsource, ground, input, output,
      andGate, ...). bbox is optional and, when present on every component of both sides, is used to
      pair predicted components with ground-truth ones (same type, greedy IoU >= 0.5); otherwise
      components are paired by identical id and type.
    - A pin is "<component id>:<terminal>" with the terminal names declared in ml/classes.yaml.
    - A net is the set of pins that are electrically connected; nets sharing a pin are merged and
      nets with fewer than two scored pins are ignored. MOSFET bulk pins are not scored by default
      (the switch-level solver ignores them and 3-terminal symbols omit them).
"""

import itertools
import json
import subprocess
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from class_schema import load_schema
from eval_metrics import DEFAULT_DOMAIN_RULES, IOU_MATCH_THRESHOLD, LOW_SUPPORT_N, box_iou, domain_for, rate

ML_DIR = Path(__file__).resolve().parent
BRIDGE_SCRIPT = ML_DIR / "sim_bridge" / "truth_table.cjs"
BRIDGE_TIMEOUT_S = 300

GATE_TYPES = frozenset({"andGate", "orGate", "notGate", "nandGate", "norGate", "xorGate", "xnorGate"})
HANDLE_PREFIX_TYPES = frozenset({"nmos", "pmos", "vsource", "ground", "clockSource"})
BULK_TERMINALS: frozenset[tuple[str, str]] = frozenset({("nmos", "b"), ("pmos", "b")})
DEFAULT_SUPPLY_VOLTS = 5


class NetlistError(ValueError):
    """Raised when a netlist file or dict violates the schema."""


class BridgeError(RuntimeError):
    """Raised when the Node simulator bridge cannot run (node or frontend dependencies missing)."""


@dataclass(frozen=True)
class Component:
    """One circuit component of a netlist."""

    id: str
    type: str
    bbox: tuple[float, float, float, float] | None = None


@dataclass
class Netlist:
    """A circuit as components plus nets (sets of pins "<id>:<terminal>")."""

    components: dict[str, Component] = field(default_factory=dict)
    nets: list[frozenset[str]] = field(default_factory=list)


def node_terminals() -> dict[str, tuple[str, ...]]:
    """
    Terminal names per frontend node type, from ml/classes.yaml.

    Returns:
        Mapping node type -> terminals (the non-canvas 'junction' type is excluded).
    """
    return {c.node_type: c.terminals for c in load_schema().classes if c.node_type != "junction"}


def parse_netlist(raw: Mapping[str, object], terminals: Mapping[str, Sequence[str]] | None = None) -> Netlist:
    """
    Validate a netlist dict and normalise its nets.

    Args:
        raw: Parsed netlist JSON.
        terminals: Node type -> allowed terminals (defaults to the classes.yaml vocabulary).
    Returns:
        The Netlist, with nets that share a pin merged (duplicates and singletons are kept; scoring drops them).
    Raises:
        NetlistError: On unknown types, duplicate ids, malformed pins, or pins on unknown components/terminals.
    """
    terms = terminals if terminals is not None else node_terminals()
    comps_raw = raw.get("components")
    nets_raw = raw.get("nets")
    if not isinstance(comps_raw, list) or not isinstance(nets_raw, list):
        raise NetlistError("netlist needs 'components' and 'nets' lists")
    components: dict[str, Component] = {}
    for entry in comps_raw:
        if not isinstance(entry, dict) or not isinstance(entry.get("id"), str) or not isinstance(entry.get("type"), str):
            raise NetlistError(f"malformed component {entry!r}")
        cid, ctype = entry["id"], entry["type"]
        if ctype not in terms:
            raise NetlistError(f"component {cid}: unknown type {ctype!r}")
        if cid in components or ":" in cid:
            raise NetlistError(f"component id {cid!r} is duplicated or contains ':'")
        bbox_raw = entry.get("bbox")
        bbox: tuple[float, float, float, float] | None = None
        if bbox_raw is not None:
            if not isinstance(bbox_raw, list) or len(bbox_raw) != 4:
                raise NetlistError(f"component {cid}: bbox must be [x1, y1, x2, y2]")
            bbox = (float(bbox_raw[0]), float(bbox_raw[1]), float(bbox_raw[2]), float(bbox_raw[3]))
        components[cid] = Component(cid, ctype, bbox)
    parent: dict[str, str] = {}

    def find(pin: str) -> str:
        """Union-find root of a pin."""
        parent.setdefault(pin, pin)
        while parent[pin] != pin:
            parent[pin] = parent[parent[pin]]
            pin = parent[pin]
        return pin

    for net in nets_raw:
        if not isinstance(net, list) or not all(isinstance(p, str) for p in net):
            raise NetlistError(f"malformed net {net!r}")
        for pin in net:
            cid, _, term = pin.partition(":")
            if cid not in components or term not in terms[components[cid].type]:
                raise NetlistError(f"pin {pin!r} does not name a terminal of a declared component")
            find(pin)
        for other in net[1:]:
            parent[find(other)] = find(net[0])
    groups: dict[str, set[str]] = {}
    for pin in parent:
        groups.setdefault(find(pin), set()).add(pin)
    return Netlist(components, [frozenset(g) for g in sorted(groups.values(), key=lambda s: sorted(s))])


def load_netlist(path: Path) -> Netlist:
    """
    Read and validate a netlist JSON file.

    Args:
        path: Netlist JSON file.
    Returns:
        The parsed Netlist.
    Raises:
        NetlistError: If the file is not valid JSON or violates the schema.
        FileNotFoundError: If the file does not exist.
    """
    try:
        raw = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise NetlistError(f"{path}: invalid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise NetlistError(f"{path}: expected a JSON object")
    return parse_netlist(raw)


def match_components(gt: Netlist, pred: Netlist, mode: str = "auto", iou_threshold: float = IOU_MATCH_THRESHOLD) -> dict[str, str]:
    """
    Pair predicted components with ground-truth components.

    Args:
        gt: Ground-truth netlist.
        pred: Predicted netlist.
        mode: 'bbox' (IoU, same type), 'id' (same id and type) or 'auto' (bbox when every component of both
            sides has one, otherwise id).
        iou_threshold: Minimum IoU for bbox pairing.
    Returns:
        Mapping predicted component id -> ground-truth component id (one-to-one).
    Raises:
        ValueError: If mode is unknown, or 'bbox' is requested but a component has no bbox.
    """
    if mode not in {"auto", "bbox", "id"}:
        raise ValueError(f"Unknown match mode {mode!r}")
    have_boxes = all(c.bbox for c in gt.components.values()) and all(c.bbox for c in pred.components.values())
    if mode == "bbox" and not have_boxes:
        raise ValueError("bbox matching needs a bbox on every component of both netlists")
    if mode == "id" or (mode == "auto" and not have_boxes):
        return {pid: pid for pid, c in pred.components.items() if pid in gt.components and gt.components[pid].type == c.type}
    gids, pids = list(gt.components), list(pred.components)
    if not gids or not pids:
        return {}
    iou = box_iou(
        _as_array([gt.components[g].bbox for g in gids]),
        _as_array([pred.components[p].bbox for p in pids]),
    )
    candidates = sorted(
        ((float(iou[i, j]), i, j) for i in range(len(gids)) for j in range(len(pids)) if iou[i, j] >= iou_threshold and gt.components[gids[i]].type == pred.components[pids[j]].type),
        reverse=True,
    )
    mapping: dict[str, str] = {}
    used_gt: set[str] = set()
    for _, i, j in candidates:
        if gids[i] in used_gt or pids[j] in mapping:
            continue
        used_gt.add(gids[i])
        mapping[pids[j]] = gids[i]
    return mapping


def _as_array(boxes: Sequence[tuple[float, float, float, float] | None]) -> np.ndarray:
    """
    Stack bboxes into an (n, 4) float array.

    Args:
        boxes: Boxes (all non-None).
    Returns:
        numpy array of shape (n, 4).
    """
    return np.asarray([b for b in boxes], dtype=np.float64).reshape(-1, 4)


def scored_nets(netlist: Netlist, score_bulk: bool = False) -> list[frozenset[str]]:
    """
    Nets reduced to scored pins, dropping nets with fewer than two pins.

    Args:
        netlist: Netlist to reduce.
        score_bulk: Keep MOSFET bulk pins when True.
    Returns:
        List of pin sets with at least two pins.
    """
    kept: list[frozenset[str]] = []
    for net in netlist.nets:
        pins = frozenset(p for p in net if score_bulk or (netlist.components[p.partition(":")[0]].type, p.partition(":")[2]) not in BULK_TERMINALS)
        if len(pins) >= 2:
            kept.append(pins)
    return kept


def remap_pins(nets: Sequence[frozenset[str]], mapping: Mapping[str, str]) -> list[frozenset[str]]:
    """
    Rename predicted pins into ground-truth component ids; unmatched components get a 'pred~' prefix.

    Args:
        nets: Predicted nets.
        mapping: Predicted component id -> ground-truth component id.
    Returns:
        Nets expressed over ground-truth ids (unmatched pins can never equal a ground-truth pin).
    """

    def rename(pin: str) -> str:
        """Rename one pin."""
        cid, _, term = pin.partition(":")
        return f"{mapping[cid]}:{term}" if cid in mapping else f"pred~{cid}:{term}"

    return [frozenset(rename(p) for p in net) for net in nets]


def pin_pairs(nets: Sequence[frozenset[str]]) -> set[frozenset[str]]:
    """
    Every unordered pin pair that shares a net.

    Args:
        nets: Pin sets.
    Returns:
        Set of 2-element frozensets.
    """
    return {frozenset(pair) for net in nets for pair in itertools.combinations(sorted(net), 2)}


def connectivity_scores(gt_pairs: set[frozenset[str]], pred_pairs: set[frozenset[str]]) -> dict[str, int]:
    """
    Pin-pair counts behind net precision/recall.

    Args:
        gt_pairs: Ground-truth connected pin pairs.
        pred_pairs: Predicted connected pin pairs (already in ground-truth ids).
    Returns:
        Dict with tp, fp, fn.
    """
    tp = len(gt_pairs & pred_pairs)
    return {"tp": tp, "fp": len(pred_pairs) - tp, "fn": len(gt_pairs) - tp}


def prf(tp: int, fp: int, fn: int) -> dict[str, float | None]:
    """
    Precision, recall and F1 from counts.

    Args:
        tp: True positives.
        fp: False positives.
        fn: False negatives.
    Returns:
        Dict with precision, recall, f1 (None where the denominator is 0).
    """
    p = tp / (tp + fp) if tp + fp else None
    r = tp / (tp + fn) if tp + fn else None
    f1 = 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else None
    return {"precision": p, "recall": r, "f1": f1}


def to_digisim(netlist: Netlist, id_map: Mapping[str, str] | None = None) -> dict[str, list[dict[str, object]]]:
    """
    Rebuild a netlist as a DigiSim (ReactFlow) canvas: nodes plus edges using the app's handle ids.

    Each net becomes a star of edges from one root pin to every other pin; the switch-level solver
    unions edge endpoints, and gate-level evaluation follows driver -> consumer edges, so a driver
    (gate `out` or `input` pin) is preferred as the root.

    Args:
        netlist: Netlist to convert.
        id_map: Optional component id renaming (used to put a prediction in ground-truth ids).
    Returns:
        Dict with 'nodes' and 'edges' lists.
    """
    rename = id_map or {}
    nodes = []
    for comp in netlist.components.values():
        nid = rename.get(comp.id, comp.id)
        data: dict[str, object] = {"label": nid}
        if comp.type == "input":
            data["value"] = 0
        elif comp.type == "output":
            data["value"] = 0
        elif comp.type == "vsource":
            data["param"] = DEFAULT_SUPPLY_VOLTS
        nodes.append({"id": nid, "type": comp.type, "position": {"x": 0, "y": 0}, "data": data})

    def split(pin: str) -> tuple[str, str, str]:
        """Return (node id, node type, terminal) of a pin."""
        cid, _, term = pin.partition(":")
        return rename.get(cid, cid), netlist.components[cid].type, term

    def is_driver(pin: str) -> bool:
        """True for a pin that drives a net in gate-level evaluation."""
        _, ntype, term = split(pin)
        return (ntype == "input" and term == "out") or (ntype in GATE_TYPES and term == "out")

    def source_handle(pin: str) -> str | None:
        """Source handle id for a pin."""
        _, ntype, term = split(pin)
        return f"s:{term}" if ntype in HANDLE_PREFIX_TYPES else None

    def target_handle(pin: str) -> str | None:
        """Target handle id for a pin."""
        _, ntype, term = split(pin)
        if ntype in HANDLE_PREFIX_TYPES:
            return f"t:{term}"
        return term if ntype in GATE_TYPES else None

    edges = []
    for net in netlist.nets:
        pins = sorted(net)
        if len(pins) < 2:
            continue
        root = next((p for p in pins if is_driver(p)), None) or next((p for p in pins if split(p)[1] != "output"), pins[0])
        for pin in pins:
            if pin == root:
                continue
            edges.append(
                {
                    "id": f"e{len(edges)}",
                    "source": split(root)[0],
                    "sourceHandle": source_handle(root),
                    "target": split(pin)[0],
                    "targetHandle": target_handle(pin),
                }
            )
    return {"nodes": nodes, "edges": edges}


def run_truth_tables(circuits: Mapping[str, dict[str, list[dict[str, object]]]]) -> dict[str, dict[str, object]]:
    """
    Simulate circuits with DigiSim's simulator (one Node process for the whole batch).

    Args:
        circuits: Mapping circuit id -> {'nodes', 'edges'} as built by to_digisim().
    Returns:
        Mapping circuit id -> {'inputs', 'outputs', 'rows'} or {'error': message}.
    Raises:
        BridgeError: If node or the frontend dependencies are unavailable, or the bridge crashes.
    """
    payload = json.dumps({"circuits": [{"id": cid, **graph} for cid, graph in circuits.items()]})
    try:
        proc = subprocess.run(["node", str(BRIDGE_SCRIPT)], input=payload, capture_output=True, text=True, timeout=BRIDGE_TIMEOUT_S, check=False)
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        raise BridgeError(f"cannot run the simulator bridge: {exc}") from exc
    if proc.returncode != 0:
        raise BridgeError(f"simulator bridge failed (is `cd frontend && npm install` done?): {proc.stderr.strip()[-500:]}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise BridgeError(f"simulator bridge returned invalid JSON: {exc}") from exc


def tables_equivalent(gt_table: Mapping[str, object], pred_table: Mapping[str, object]) -> bool:
    """
    Whether two truth tables are identical (same inputs, outputs and every row).

    Args:
        gt_table: Ground-truth table from the bridge.
        pred_table: Predicted table from the bridge.
    Returns:
        True when inputs, outputs and rows all match; False if either side errored.
    """
    if "error" in gt_table or "error" in pred_table:
        return False
    return all(gt_table.get(k) == pred_table.get(k) for k in ("inputs", "outputs", "rows"))


@dataclass
class CircuitResult:
    """Per-circuit end-to-end outcome (pin-pair counts, exact match, truth-table status)."""

    stem: str
    domain: str
    gt_components: int
    pred_components: int
    matched_components: int
    tp: int
    fp: int
    fn: int
    exact_match: bool
    pred_error: str | None = None
    # 'equivalent' | 'different' | 'gt_unsimulatable' | None (truth table not requested)
    truth_table: str | None = None
    truth_table_detail: str | None = None

    def to_dict(self) -> dict[str, object]:
        """
        JSON-ready form of the record.

        Returns:
            Dict with components, pairs, exact_match, pred_error and truth_table.
        """
        return {
            "domain": self.domain,
            "components": {"gt": self.gt_components, "pred": self.pred_components, "matched": self.matched_components},
            "pairs": {"tp": self.tp, "fp": self.fp, "fn": self.fn},
            "exact_match": self.exact_match,
            "pred_error": self.pred_error,
            "truth_table": None if self.truth_table is None else {"status": self.truth_table, "detail": self.truth_table_detail},
        }


def evaluate_netlists(
    gt_dir: Path,
    pred_dir: Path,
    truth_table: bool = True,
    match_mode: str = "auto",
    score_bulk: bool = False,
    domain_rules: Sequence[tuple[str, str]] = DEFAULT_DOMAIN_RULES,
) -> dict[str, object]:
    """
    End-to-end metrics over every ground-truth netlist in gt_dir.

    A missing or malformed prediction scores as an empty circuit (zero recall, no equivalence).

    Args:
        gt_dir: Directory of ground-truth netlists named <image stem>.json.
        pred_dir: Directory of predicted netlists with the same stems.
        truth_table: Also compute truth-table equivalence with DigiSim's simulator.
        match_mode: Component pairing mode (see match_components).
        score_bulk: Score MOSFET bulk pins too.
        domain_rules: (filename prefix, domain) rules used to group circuits per domain.
    Returns:
        Dict with per-circuit records, micro/macro net P/R/F1, exact-match rate and truth-table equivalence
        rate (with Wilson CIs), overall and per domain.
    Raises:
        FileNotFoundError: If gt_dir does not exist or holds no netlists.
        NetlistError: If a ground-truth netlist is malformed.
        BridgeError: If truth-table equivalence is requested but the simulator bridge cannot run.
    """
    gt_files = sorted(gt_dir.glob("*.json"))
    if not gt_dir.is_dir() or not gt_files:
        raise FileNotFoundError(f"No ground-truth netlists in {gt_dir}")
    records: dict[str, CircuitResult] = {}
    sim_inputs: dict[str, dict[str, list[dict[str, object]]]] = {}
    for gt_file in gt_files:
        stem = gt_file.stem
        gt = load_netlist(gt_file)
        pred_file = pred_dir / gt_file.name
        pred_error: str | None = None
        pred = Netlist()
        if not pred_file.exists():
            pred_error = "missing prediction"
        else:
            try:
                pred = load_netlist(pred_file)
            except NetlistError as exc:
                pred_error = str(exc)
        mapping = match_components(gt, pred, match_mode)
        gt_nets = scored_nets(gt, score_bulk)
        pred_nets = remap_pins(scored_nets(pred, score_bulk), mapping)
        counts = connectivity_scores(pin_pairs(gt_nets), pin_pairs(pred_nets))
        comps_ok = len(pred.components) == len(gt.components) == len(mapping)
        records[stem] = CircuitResult(
            stem=stem,
            domain=domain_for(stem, domain_rules),
            gt_components=len(gt.components),
            pred_components=len(pred.components),
            matched_components=len(mapping),
            tp=counts["tp"],
            fp=counts["fp"],
            fn=counts["fn"],
            exact_match=comps_ok and set(gt_nets) == set(pred_nets),
            pred_error=pred_error,
        )
        if truth_table:
            sim_inputs[f"gt::{stem}"] = to_digisim(gt)
            sim_inputs[f"pred::{stem}"] = to_digisim(pred, {pid: mapping.get(pid, f"pred~{pid}") for pid in pred.components})
    if truth_table:
        tables = run_truth_tables(sim_inputs)
        for stem, rec in records.items():
            gt_t, pred_t = tables[f"gt::{stem}"], tables[f"pred::{stem}"]
            if "error" in gt_t:
                rec.truth_table, rec.truth_table_detail = "gt_unsimulatable", str(gt_t["error"])
            else:
                rec.truth_table = "equivalent" if tables_equivalent(gt_t, pred_t) else "different"
                rec.truth_table_detail = str(pred_t["error"]) if "error" in pred_t else None
    domains = sorted({r.domain for r in records.values()})
    return {
        "settings": {"match_mode": match_mode, "score_bulk": score_bulk, "truth_table": truth_table, "iou": IOU_MATCH_THRESHOLD},
        "overall": aggregate(list(records.values())),
        "per_domain": {d: aggregate([r for r in records.values() if r.domain == d]) for d in domains},
        "circuits": {stem: r.to_dict() for stem, r in records.items()},
    }


def aggregate(records: Sequence[CircuitResult]) -> dict[str, object]:
    """
    Aggregate per-circuit results into end-to-end metrics.

    Args:
        records: Per-circuit results.
    Returns:
        Dict with circuits, low_support, micro/macro net scores, exact_match and truth_table rates.
    """
    tp = sum(r.tp for r in records)
    fp = sum(r.fp for r in records)
    fn = sum(r.fn for r in records)
    per_circuit = [prf(r.tp, r.fp, r.fn) for r in records]
    macro: dict[str, float | None] = {}
    for key in ("precision", "recall", "f1"):
        vals = [m[key] for m in per_circuit if m[key] is not None]
        macro[key] = sum(vals) / len(vals) if vals else None
    n = len(records)
    exact = sum(1 for r in records if r.exact_match)
    requested = [r for r in records if r.truth_table is not None]
    simulatable = [r for r in requested if r.truth_table != "gt_unsimulatable"]
    equivalent = sum(1 for r in simulatable if r.truth_table == "equivalent")
    return {
        "circuits": n,
        "low_support": n < LOW_SUPPORT_N,
        "net_micro": {**prf(tp, fp, fn), "pairs_tp": tp, "pairs_fp": fp, "pairs_fn": fn},
        "net_macro": macro,
        "net_f1_micro_ci95": rate(2 * tp, 2 * tp + fp + fn)["ci95"],
        "exact_match": rate(exact, n),
        "truth_table": {**rate(equivalent, len(simulatable)), "gt_unsimulatable": len(requested) - len(simulatable)},
    }
