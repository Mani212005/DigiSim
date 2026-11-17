"""
Module: eval_report.py
Purpose: Renders an evaluation run (the JSON produced by evaluate.py) as one Markdown document:
         run header, overall/per-class/per-domain detection tables with Wilson CIs, confusion
         matrix, small-object recall, end-to-end netlist metrics, the legacy ultralytics numbers
         and the reproduction check, with optional deltas against a committed baseline run.
"""

from collections.abc import Mapping, Sequence
from typing import Any

# Parsed JSON document (reports are plain nested dicts/lists).
JsonDict = dict[str, Any]

F1_GATE = 0.95
ACC_GATE = 0.95
REAL_F1_GATE = 0.85
JUNCTION_RECALL_GATE = 0.90


def fmt_rate(rec: JsonDict | None, digits: int = 3) -> str:
    """
    Format a rate record as `value [lo, hi]`.

    Args:
        rec: Record with value and ci95 (see eval_metrics.rate), or None.
        digits: Decimal places.
    Returns:
        The formatted cell, or "n/a" when the value is undefined.
    """
    if not rec or rec.get("value") is None:
        return "n/a"
    value = float(rec["value"])
    ci = rec.get("ci95")
    if not ci:
        return f"{value:.{digits}f}"
    lo, hi = ci
    return f"{value:.{digits}f} [{lo:.{digits}f}, {hi:.{digits}f}]"


def _value(rec: JsonDict | None) -> float | None:
    """
    The numeric value of a rate record.

    Args:
        rec: Rate record or None.
    Returns:
        The value, or None when absent.
    """
    if not rec or rec.get("value") is None:
        return None
    return float(rec["value"])


def verdict(record: JsonDict, domain: str | None) -> str:
    """
    Pass/fail verdict for one class record under the phase gate.

    Synthetic and overall rows need F1 >= 0.95 and accuracy >= 0.95; real-image domains need F1 >= 0.85
    (agent_docs/ml-pipeline.md, phase 2). Classes with too little support are labelled instead of judged.

    Args:
        record: Per-class record from DetectionAccumulator.per_class().
        domain: Domain name, or None for the overall table.
    Returns:
        'PASS', 'FAIL', 'no GT' (no ground-truth instances) or 'low n' (verdict not trustworthy).
    """
    if int(record["gt"]) == 0:
        return "no GT"
    f1, acc = _value(record["f1"]), _value(record["accuracy"])
    real = bool(domain and domain.endswith("_real"))
    ok = f1 is not None and acc is not None and f1 >= (REAL_F1_GATE if real else F1_GATE) and (real or acc >= ACC_GATE)
    if record["low_support"]:
        return f"low n ({'pass' if ok else 'fail'})"
    return "PASS" if ok else "FAIL"


def _num(value: float | None, signed: bool = False) -> str:
    """
    Format an optional number to four decimals.

    Args:
        value: Number or None.
        signed: Always show the sign.
    Returns:
        The formatted number, or 'missing' for None.
    """
    if value is None:
        return "missing"
    return f"{value:+.4f}" if signed else f"{value:.4f}"


def _table(headers: Sequence[str], rows: Sequence[Sequence[str]]) -> list[str]:
    """
    A GitHub-flavoured Markdown table.

    Args:
        headers: Column headers.
        rows: Row cells.
    Returns:
        Lines of the table.
    """
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    lines += ["| " + " | ".join(r) + " |" for r in rows]
    return lines


def _delta(current: float | None, base: float | None) -> str:
    """
    Signed difference against a baseline value.

    Args:
        current: Current value.
        base: Baseline value.
    Returns:
        Like "+0.012", or "-" when either side is missing.
    """
    if current is None or base is None:
        return "-"
    return f"{current - base:+.3f}"


def _class_table(per_class: Mapping[str, JsonDict], domain: str | None, base: Mapping[str, JsonDict] | None) -> list[str]:
    """
    Per-class metric table.

    Args:
        per_class: Class name -> record.
        domain: Domain name or None for overall.
        base: Baseline per-class records for the same scope, or None.
    Returns:
        Table lines.
    """
    headers = ["class", "GT", "TP", "FP", "FN", "precision", "recall = accuracy", "F1", "verdict"]
    if base is not None:
        headers.append("dF1 vs baseline")
    rows = []
    for name, rec in per_class.items():
        row = [
            name,
            str(rec["gt"]),
            str(rec["tp"]),
            str(rec["fp"]),
            str(rec["fn"]),
            fmt_rate(rec["precision"]),
            fmt_rate(rec["recall"]),
            fmt_rate(rec["f1"]),
            verdict(rec, domain),
        ]
        if base is not None:
            row.append(_delta(_value(rec["f1"]), _value(base.get(name, {}).get("f1"))))
        rows.append(row)
    return _table(headers, rows)


def _confusion_table(conf: JsonDict) -> list[str]:
    """
    Confusion matrix as a table (rows = predicted, columns = ground truth).

    Args:
        conf: Confusion record from DetectionAccumulator.confusion().
    Returns:
        Table lines.
    """
    labels = [str(x) for x in conf["labels"]]
    matrix = conf["matrix"]
    rows = [[f"**{labels[i]}**", *[str(v) if v else "." for v in matrix[i]]] for i in range(len(labels))]
    return _table(["pred \\ GT", *labels], rows)


def _e2e_rows(label: str, rec: JsonDict) -> list[str]:
    """
    One end-to-end summary row.

    Args:
        label: Row label (scope name).
        rec: Aggregate record from eval_netlist.aggregate().
    Returns:
        Table cells.
    """
    micro, macro = rec["net_micro"], rec["net_macro"]
    f = lambda v: "n/a" if v is None else f"{v:.3f}"  # noqa: E731
    return [
        label,
        str(rec["circuits"]),
        f(micro["precision"]),
        f(micro["recall"]),
        f(micro["f1"]),
        f(macro["f1"]),
        fmt_rate(rec["exact_match"]),
        fmt_rate(rec["truth_table"]),
    ]


def render_markdown(report: JsonDict, baseline: JsonDict | None = None) -> str:
    """
    Render a whole evaluation report as Markdown.

    Args:
        report: The evaluate.py JSON report.
        baseline: A previous report to show deltas against (same schema), or None.
    Returns:
        The Markdown text.
    """
    run = report["run"]
    lines = [f"# DigiSim evaluation - {run['name']}", ""]
    lines += [
        f"- generated: {run['generated_at']}",
        f"- weights: `{run['weights']['name']}` sha256 `{str(run['weights']['sha256'])[:16]}...`" if run.get("weights") else "- weights: none (end-to-end only)",
        f"- dataset: `{run['dataset']['frozen_name']}` split `{run['dataset']['split']}`, {run['dataset']['images']} images, frozen sha256 `{str(run['dataset']['sha256'])[:16]}...` (verified)",
        f"- params: {run['params']}",
        "",
    ]
    det = report.get("detection")
    if det:
        base_det = (baseline or {}).get("detection")
        ov = det["overall"]
        lines += ["## Detection - overall", ""]
        lines += _table(
            ["images", "GT", "precision", "recall", "F1", "small-object recall", "unmapped preds"],
            [
                [
                    str(ov["images"]),
                    str(ov["gt"]),
                    fmt_rate(ov["precision"]),
                    fmt_rate(ov["recall"]),
                    fmt_rate(ov["f1"]),
                    fmt_rate(ov["small_object"]["recall"]) + f" (side <= {ov['small_object']['max_side_px']:g}px)",
                    str(ov["unmapped_predictions"]),
                ]
            ],
        )
        lines += [
            "",
            f"Operating point: conf >= {det['conf']}, IoU >= {det['iou_threshold']}.",
            f"Verdicts: F1 >= {F1_GATE} and accuracy >= {ACC_GATE} (synthetic / overall), F1 >= {REAL_F1_GATE} (real domains); `low n` = fewer than 30 GT instances.",
            "",
        ]
        jr = det.get("junction_recall")
        if jr:
            lines += [f"JUNCTION recall: {fmt_rate(jr)} (gate: >= {JUNCTION_RECALL_GATE})", ""]
        lines += ["## Detection - per class (all domains)", ""]
        lines += _class_table(det["per_class"], None, base_det["per_class"] if base_det else None)
        for domain, drec in det["per_domain"].items():
            lines += ["", f"## Detection - domain `{domain}` ({drec['overall']['images']} images, {drec['overall']['gt']} GT)", ""]
            base_dom = ((base_det or {}).get("per_domain") or {}).get(domain)
            lines += _class_table(drec["per_class"], domain, base_dom["per_class"] if base_dom else None)
        lines += ["", "## Confusion matrix (all domains)", ""]
        lines += _confusion_table(det["confusion_matrix"])
    e2e = report.get("end_to_end")
    if e2e:
        lines += ["", "## End-to-end (netlist)", ""]
        rows = [_e2e_rows("overall", e2e["overall"])]
        rows += [_e2e_rows(d, rec) for d, rec in e2e["per_domain"].items()]
        lines += _table(["scope", "circuits", "net P (micro)", "net R (micro)", "net F1 (micro)", "net F1 (macro)", "exact match", "truth-table equiv."], rows)
        lines += ["", "Net P/R/F1 are over pin-pair connectivity (micro = pooled pairs, macro = mean per circuit). Intervals are Wilson 95%.", ""]
    legacy = report.get("legacy")
    if legacy:
        lines += ["", "## Legacy ultralytics validation (phase-gate numbers)", "", f"mAP@0.5 = {legacy['map50']:.4f}, mAP@0.5:0.95 = {legacy['map50_95']:.4f}", ""]
        lines += _table(
            ["class", "F1 (max-F1 conf)", "accuracy (confusion matrix)"],
            [[n, f"{m.get('f1', float('nan')):.4f}", f"{m.get('accuracy', float('nan')):.4f}"] for n, m in legacy["per_class"].items()],
        )
    repro = report.get("reproduction")
    if repro:
        lines += [
            "",
            "## Reproduction of the reference numbers",
            "",
            f"Reference: `{repro['reference']}`; tolerance {repro['tolerance']}; max abs delta {_num(repro['max_abs_delta'])}.",
            f"Result: **{'OK' if repro['ok'] else 'OUT OF TOLERANCE'}**",
            "",
        ]
        lines += _table(["metric", "reference", "this run", "delta"], [[r["metric"], f"{r['reference']:.4f}", _num(r["value"]), _num(r["delta"], signed=True)] for r in repro["rows"]])
    return "\n".join(lines) + "\n"
