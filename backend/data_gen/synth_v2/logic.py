"""
Module: logic.py
Purpose: Netlist-driven topology sampler for the synthetic dataset. Samples valid circuits
         (static CMOS cells built from series-parallel pull-down/pull-up networks, transmission
         gate muxes, multi-stage compositions, and gate-level DAGs), expands them into logical
         devices with exact pin-to-net assignments, computes the reference truth table from the
         abstract boolean function, and hashes the topology so dataset splits never share a
         circuit. The renderer consumes the series-parallel trees to lay out textbook CMOS.
"""

from __future__ import annotations

import hashlib
import itertools
from dataclasses import dataclass, field

import networkx as nx
import numpy as np

# A boolean expression over named signals: ("var", name) | ("and", [e, ...]) | ("or", [e, ...]).
Expr = tuple

GATE_KINDS: tuple[str, ...] = ("AND", "OR", "NOT", "NAND", "NOR", "XOR", "XNOR")
VDD_NET = "VDD"
GND_NET = "GND"
MAX_TRANSISTORS = 14
MAX_INPUTS = 4


def var(name: str) -> Expr:
    """
    Build a literal expression.

    Args:
        name: Signal (net) name.
    Returns:
        The ("var", name) expression.
    """
    return ("var", name)


def eval_expr(expr: Expr, env: dict[str, int]) -> int:
    """
    Evaluate a positive AND/OR expression.

    Args:
        expr: Expression tree.
        env: Signal values (0/1) by name.
    Returns:
        0 or 1.
    Raises:
        ValueError: If the expression kind is unknown.
    """
    kind = expr[0]
    if kind == "var":
        return env[expr[1]]
    if kind == "and":
        return int(all(eval_expr(e, env) for e in expr[1]))
    if kind == "or":
        return int(any(eval_expr(e, env) for e in expr[1]))
    raise ValueError(f"unknown expression kind {kind!r}")


def expr_literals(expr: Expr) -> list[str]:
    """
    Signals used by an expression, in first-use order.

    Args:
        expr: Expression tree.
    Returns:
        Distinct literal names.
    """
    if expr[0] == "var":
        return [expr[1]]
    out: list[str] = []
    for child in expr[1]:
        for name in expr_literals(child):
            if name not in out:
                out.append(name)
    return out


def _flatten(expr: Expr) -> Expr:
    """
    Merge nested operators of the same kind (and(and(a,b),c) -> and(a,b,c)).

    Args:
        expr: Expression tree.
    Returns:
        Equivalent flattened expression.
    """
    if expr[0] == "var":
        return expr
    kids: list[Expr] = []
    for child in expr[1]:
        flat = _flatten(child)
        if flat[0] == expr[0]:
            kids.extend(flat[1])
        else:
            kids.append(flat)
    return (expr[0], kids)


def random_expr(rng: np.random.Generator, literals: list[str]) -> Expr:
    """
    Random series-parallel expression using every literal exactly once.

    Args:
        rng: Random generator.
        literals: Distinct signal names (at least one).
    Returns:
        Flattened AND/OR expression.
    """
    nodes: list[Expr] = [var(name) for name in literals]
    order = list(rng.permutation(len(nodes)))
    nodes = [nodes[i] for i in order]
    while len(nodes) > 1:
        i = int(rng.integers(0, len(nodes) - 1))
        op = "and" if rng.random() < 0.5 else "or"
        nodes[i : i + 2] = [(op, [nodes[i], nodes[i + 1]])]
    return _flatten(nodes[0])


@dataclass
class SPNode:
    """Series-parallel switch network node; leaves are single transistors."""

    kind: str  # "leaf" | "series" | "parallel"
    children: list[SPNode] = field(default_factory=list)
    signal: str = ""
    device_id: str = ""


def sp_from_expr(expr: Expr, dual: bool) -> SPNode:
    """
    Build the switch network for a static CMOS pull-down (dual=False) or pull-up (dual=True).

    Args:
        expr: Positive expression E; the cell output is NOT E.
        dual: True for the PMOS pull-up network (AND -> parallel, OR -> series).
    Returns:
        Series-parallel tree.
    """
    if expr[0] == "var":
        return SPNode("leaf", signal=expr[1])
    series_op = "or" if dual else "and"
    kind = "series" if expr[0] == series_op else "parallel"
    return SPNode(kind, [sp_from_expr(child, dual) for child in expr[1]])


def sp_leaves(node: SPNode) -> list[SPNode]:
    """
    Leaves of a series-parallel tree in drawing order.

    Args:
        node: Tree root.
    Returns:
        Leaf nodes.
    """
    if node.kind == "leaf":
        return [node]
    out: list[SPNode] = []
    for child in node.children:
        out.extend(sp_leaves(child))
    return out


@dataclass
class Stage:
    """One transistor-level stage: a static CMOS cell (out = NOT expr) or a transmission-gate mux."""

    kind: str  # "cmos" | "tg_mux"
    out: str
    expr: Expr | None = None
    sel: str = ""
    sel_n: str = ""
    d0: str = ""
    d1: str = ""
    pun: SPNode | None = None
    pdn: SPNode | None = None
    tg_devices: list[str] = field(default_factory=list)

    def inputs(self) -> list[str]:
        """
        Signals this stage reads.

        Returns:
            Distinct input signal names.
        """
        if self.kind == "cmos":
            return expr_literals(self.expr)
        return [self.d0, self.d1, self.sel, self.sel_n]

    def evaluate(self, env: dict[str, int]) -> int:
        """
        Reference boolean value of the stage output.

        Args:
            env: Signal values by name.
        Returns:
            0 or 1.
        """
        if self.kind == "cmos":
            return 1 - eval_expr(self.expr, env)
        return env[self.d1] if env[self.sel] else env[self.d0]


@dataclass
class Device:
    """A logical device: transistor or logic gate, with terminal-to-net pins."""

    id: str
    cls: str
    pins: dict[str, str]
    stage: int = -1


@dataclass
class Circuit:
    """A sampled circuit in either domain, with its devices and reference behaviour."""

    domain: str  # "transistor" | "gate"
    recipe: str
    inputs: list[str]
    outputs: list[str]
    stages: list[Stage] = field(default_factory=list)
    devices: list[Device] = field(default_factory=list)

    def evaluate(self, env: dict[str, int]) -> dict[str, int]:
        """
        Evaluate every signal for one input assignment.

        Args:
            env: Primary input values.
        Returns:
            Values of all signals (inputs, internal nets and outputs).
        """
        values = dict(env)
        if self.domain == "transistor":
            for stage in self.stages:
                values[stage.out] = stage.evaluate(values)
        else:
            for dev in self.devices:
                ins = [values[dev.pins[t]] for t in ("a", "b") if t in dev.pins]
                values[dev.pins["out"]] = gate_function(dev.cls, ins)
        return values

    def truth_table(self) -> list[dict[str, dict[str, int]]]:
        """
        Reference truth table from the abstract function (not from the transistors).

        Returns:
            Rows of {"in": {name: v}, "out": {name: v}} in binary counting order.
        """
        rows = []
        for bits in itertools.product((0, 1), repeat=len(self.inputs)):
            env = dict(zip(self.inputs, bits))
            values = self.evaluate(env)
            rows.append({"in": env, "out": {o: values[o] for o in self.outputs}})
        return rows

    def transistor_count(self) -> int:
        """
        Number of MOSFETs in the circuit.

        Returns:
            Count of NMOS plus PMOS devices.
        """
        return sum(1 for d in self.devices if d.cls in ("NMOS", "PMOS"))


def gate_function(kind: str, ins: list[int]) -> int:
    """
    Boolean function of a 1- or 2-input logic gate.

    Args:
        kind: Gate class name (AND ... XNOR).
        ins: Input values.
    Returns:
        Output value.
    Raises:
        ValueError: If kind is not a gate class.
    """
    if kind == "NOT":
        return 1 - ins[0]
    a, b = ins
    table = {
        "AND": a & b,
        "OR": a | b,
        "NAND": 1 - (a & b),
        "NOR": 1 - (a | b),
        "XOR": a ^ b,
        "XNOR": 1 - (a ^ b),
    }
    if kind not in table:
        raise ValueError(f"not a gate class: {kind}")
    return table[kind]


# ---------------------------------------------------------------------------------------------
# Transistor-level recipes
# ---------------------------------------------------------------------------------------------

_NAMED_CELLS: dict[str, Expr] = {
    "inv": var("A"),
    "nand2": ("and", [var("A"), var("B")]),
    "nand3": ("and", [var("A"), var("B"), var("C")]),
    "nor2": ("or", [var("A"), var("B")]),
    "nor3": ("or", [var("A"), var("B"), var("C")]),
    "aoi21": ("or", [("and", [var("A"), var("B")]), var("C")]),
    "aoi22": ("or", [("and", [var("A"), var("B")]), ("and", [var("C"), var("D")])]),
    "oai21": ("and", [("or", [var("A"), var("B")]), var("C")]),
    "oai22": ("and", [("or", [var("A"), var("B")]), ("or", [var("C"), var("D")])]),
    "aoi211": ("or", [("and", [var("A"), var("B")]), var("C"), var("D")]),
    "oai211": ("and", [("or", [var("A"), var("B")]), var("C"), var("D")]),
}

TRANSISTOR_RECIPES: tuple[tuple[str, float], ...] = (
    ("named_cell", 0.22),
    ("random_cell", 0.18),
    ("and_or", 0.12),
    ("buf", 0.03),
    ("xor_xnor", 0.10),
    ("mux2_tg", 0.08),
    ("chain", 0.27),
)


def _cmos(expr: Expr, out: str) -> Stage:
    """
    Static CMOS stage computing out = NOT expr.

    Args:
        expr: Pull-down expression.
        out: Output net name.
    Returns:
        Stage with its pull-up and pull-down networks built.
    """
    return Stage("cmos", out, expr=expr, pun=sp_from_expr(expr, dual=True), pdn=sp_from_expr(expr, dual=False))


def _pick(rng: np.random.Generator, options: tuple[tuple[str, float], ...]) -> str:
    """
    Weighted choice over (name, weight) pairs.

    Args:
        rng: Random generator.
        options: Names with relative weights.
    Returns:
        The chosen name.
    """
    weights = np.array([w for _, w in options], dtype=np.float64)
    idx = int(rng.choice(len(options), p=weights / weights.sum()))
    return options[idx][0]


def _out_name(rng: np.random.Generator, used: set[str]) -> str:
    """
    Pick a primary output name not already used.

    Args:
        rng: Random generator.
        used: Names already taken.
    Returns:
        A fresh output name.
    """
    for name in [str(n) for n in rng.permutation(["Y", "Z", "F", "OUT", "W"])]:
        if name not in used:
            return name
    raise ValueError("ran out of output names")


def sample_transistor_circuit(rng: np.random.Generator) -> Circuit:
    """
    Sample a transistor-level (CMOS) circuit with a known boolean function.

    Args:
        rng: Random generator.
    Returns:
        Circuit with stages and devices; at most MAX_INPUTS inputs and MAX_TRANSISTORS devices.
    """
    while True:
        circuit = _sample_transistor_once(rng)
        _expose_internal_output(circuit, rng)
        _expand_transistors(circuit)
        if circuit.transistor_count() <= MAX_TRANSISTORS and len(circuit.inputs) <= MAX_INPUTS:
            return circuit


def _rename_expr(expr: Expr, old: str, new: str) -> Expr:
    """
    Rename one signal inside an expression.

    Args:
        expr: Expression tree.
        old: Signal to rename.
        new: New name.
    Returns:
        Renamed expression.
    """
    if expr[0] == "var":
        return var(new) if expr[1] == old else expr
    return (expr[0], [_rename_expr(e, old, new) for e in expr[1]])


def _expose_internal_output(circuit: Circuit, rng: np.random.Generator) -> None:
    """
    Sometimes make an internal stage output an extra primary output (e.g. both Y and its complement).

    Inverted copies of primary inputs (A_n, S_n) are never exposed.

    Args:
        circuit: Circuit without devices yet; modified in place.
        rng: Random generator.
    """
    internal = [st.out for st in circuit.stages if st.kind == "cmos" and st.out not in circuit.outputs and not st.out.endswith("_n")]
    if not internal or rng.random() >= 0.6:
        return
    old = internal[int(rng.integers(0, len(internal)))]
    new = _out_name(rng, set(circuit.outputs) | set(circuit.inputs))
    for st in circuit.stages:
        if st.out == old:
            st.out = new
        if st.kind == "cmos":
            st.expr = _rename_expr(st.expr, old, new)
            st.pun = sp_from_expr(st.expr, dual=True)
            st.pdn = sp_from_expr(st.expr, dual=False)
    circuit.outputs.append(new)


def _sample_transistor_once(rng: np.random.Generator) -> Circuit:
    """
    One draw of a transistor recipe (may exceed size limits; caller retries).

    Args:
        rng: Random generator.
    Returns:
        Circuit with stages but no devices yet.
    """
    recipe = _pick(rng, TRANSISTOR_RECIPES)
    if recipe == "named_cell":
        name = str(rng.choice(sorted(_NAMED_CELLS)))
        expr = _NAMED_CELLS[name]
        out = _out_name(rng, set())
        return Circuit("transistor", name, expr_literals(expr), [out], [_cmos(expr, out)])
    if recipe == "random_cell":
        n = int(rng.integers(2, 5))
        ins = ["A", "B", "C", "D"][:n]
        expr = random_expr(rng, ins)
        out = _out_name(rng, set())
        return Circuit("transistor", f"random_cell{n}", ins, [out], [_cmos(expr, out)])
    if recipe == "and_or":
        n = int(rng.integers(2, 4))
        ins = ["A", "B", "C"][:n]
        op = "and" if rng.random() < 0.5 else "or"
        out = _out_name(rng, set())
        stages = [_cmos((op, [var(i) for i in ins]), "n1"), _cmos(var("n1"), out)]
        return Circuit("transistor", f"{op}{n}", ins, [out], stages)
    if recipe == "buf":
        out = _out_name(rng, set())
        return Circuit("transistor", "buf", ["A"], [out], [_cmos(var("A"), "n1"), _cmos(var("n1"), out)])
    if recipe == "xor_xnor":
        is_xor = rng.random() < 0.5
        out = _out_name(rng, set())
        a, b, an, bn = var("A"), var("B"), var("A_n"), var("B_n")
        expr = ("or", [("and", [a, b]), ("and", [an, bn])]) if is_xor else ("or", [("and", [a, bn]), ("and", [an, b])])
        stages = [_cmos(a, "A_n"), _cmos(b, "B_n"), _cmos(expr, out)]
        return Circuit("transistor", "xor2" if is_xor else "xnor2", ["A", "B"], [out], stages)
    if recipe == "mux2_tg":
        out = _out_name(rng, set())
        mux = Stage("tg_mux", out, sel="S", sel_n="S_n", d0="D0", d1="D1")
        return Circuit("transistor", "mux2_tg", ["D0", "D1", "S"], [out], [_cmos(var("S"), "S_n"), mux])
    return _sample_chain(rng)


def _sample_chain(rng: np.random.Generator) -> Circuit:
    """
    Random composition of 2-3 CMOS stages where later stages consume earlier outputs.

    Args:
        rng: Random generator.
    Returns:
        Circuit whose outputs are the stage outputs nobody consumes.
    """
    n_stages = int(rng.integers(2, 4))
    pool = ["A", "B", "C", "D"]
    n_in = int(rng.integers(2, 5))
    inputs = pool[:n_in]
    stages: list[Stage] = []
    produced: list[str] = []
    consumed: set[str] = set()
    for k in range(n_stages):
        lits: list[str] = []
        if produced:
            lits.append(produced[-1])
            if len(produced) > 1 and rng.random() < 0.3:
                lits.append(produced[-2])
        extra = int(rng.integers(1, 3)) if produced else int(rng.integers(2, 4))
        fresh = [s for s in inputs if s not in consumed]
        stale = [s for s in inputs if s in consumed]
        candidates = fresh + [stale[i] for i in rng.permutation(len(stale))]
        for s in candidates[:extra]:
            lits.append(s)
        lits = lits[:4]
        expr = random_expr(rng, lits)
        out = f"n{k + 1}"
        stages.append(_cmos(expr, out))
        consumed.update(lits)
        produced.append(out)
    used_inputs = [s for s in inputs if s in consumed]
    sinks = [s.out for s in stages if s.out not in consumed]
    rename: dict[str, str] = {}
    taken: set[str] = set()
    for s in sinks:
        rename[s] = _out_name(rng, taken)
        taken.add(rename[s])
    for st in stages:
        st.out = rename.get(st.out, st.out)
    outputs = [rename[s] for s in sinks]
    return Circuit("transistor", f"chain{n_stages}", used_inputs, outputs, stages)


def _expand_transistors(circuit: Circuit) -> None:
    """
    Turn stages into NMOS/PMOS devices with drawing-consistent terminal names.

    The canonical symbols are vertical: NMOS drain on top, PMOS source on top. A leaf's top
    and bottom nets therefore map to (d, s) for NMOS and (s, d) for PMOS. Transmission gates
    are drawn horizontally with the source on the left (data side) and drain on the right.

    Args:
        circuit: Circuit whose stages are filled in; devices are appended in place.
    """
    counter = itertools.count(1)
    net_counter = itertools.count(1)
    circuit.devices = []

    def build(node: SPNode, top: str, bottom: str, cls: str, stage_idx: int) -> None:
        """Assign devices and intermediate nets for one series-parallel subtree."""
        if node.kind == "leaf":
            node.device_id = f"M{next(counter)}"
            t_name, b_name = ("d", "s") if cls == "NMOS" else ("s", "d")
            circuit.devices.append(Device(node.device_id, cls, {t_name: top, "g": node.signal, b_name: bottom}, stage_idx))
        elif node.kind == "parallel":
            for child in node.children:
                build(child, top, bottom, cls, stage_idx)
        else:
            nets = [top] + [f"x{next(net_counter)}" for _ in node.children[:-1]] + [bottom]
            for i, child in enumerate(node.children):
                build(child, nets[i], nets[i + 1], cls, stage_idx)

    for idx, stage in enumerate(circuit.stages):
        if stage.kind == "cmos":
            build(stage.pun, VDD_NET, stage.out, "PMOS", idx)
            build(stage.pdn, stage.out, GND_NET, "NMOS", idx)
        else:
            stage.tg_devices = []
            for data, n_gate, p_gate in ((stage.d0, stage.sel_n, stage.sel), (stage.d1, stage.sel, stage.sel_n)):
                for cls, g in (("NMOS", n_gate), ("PMOS", p_gate)):
                    dev_id = f"M{next(counter)}"
                    circuit.devices.append(Device(dev_id, cls, {"s": data, "g": g, "d": stage.out}, idx))
                    stage.tg_devices.append(dev_id)


# ---------------------------------------------------------------------------------------------
# Gate-level recipes
# ---------------------------------------------------------------------------------------------


def sample_gate_circuit(rng: np.random.Generator) -> Circuit:
    """
    Sample a gate-level DAG (2-4 inputs, 2-8 gates, depth <= 4, 1-3 outputs).

    Args:
        rng: Random generator.
    Returns:
        Circuit with gate devices in topological order.
    """
    while True:
        circuit = _sample_gate_once(rng)
        if circuit is not None:
            return circuit


def _sample_gate_once(rng: np.random.Generator) -> Circuit | None:
    """
    One draw of a random gate DAG; None when the draw violates the shape limits.

    Args:
        rng: Random generator.
    Returns:
        Circuit or None.
    """
    n_in = int(rng.integers(2, 5))
    inputs = ["A", "B", "C", "D"][:n_in]
    n_gates = int(rng.integers(2, 9))
    depth: dict[str, int] = {s: 0 for s in inputs}
    use: dict[str, int] = {s: 0 for s in inputs}
    devices: list[Device] = []
    for k in range(n_gates):
        kind = GATE_KINDS[int(rng.integers(0, len(GATE_KINDS)))]
        arity = 1 if kind == "NOT" else 2
        signals = list(depth)
        unused = [s for s in signals if use[s] == 0]
        chosen: list[str] = []
        for _ in range(arity):
            pool = [s for s in (unused if unused and rng.random() < 0.8 else signals) if s not in chosen]
            if not pool:
                pool = [s for s in signals if s not in chosen]
            pick = pool[int(rng.integers(0, len(pool)))]
            chosen.append(pick)
            if pick in unused:
                unused.remove(pick)
        out = f"g{k + 1}"
        pins = {t: s for t, s in zip(("a", "b") if arity == 2 else ("a",), chosen)}
        pins["out"] = out
        devices.append(Device(f"U{k + 1}", kind, pins))
        for s in chosen:
            use[s] += 1
        depth[out] = 1 + max(depth[s] for s in chosen)
        use[out] = 0
    if max(depth.values()) > 4:
        return None
    sinks = [d.pins["out"] for d in devices if use[d.pins["out"]] == 0]
    if not 1 <= len(sinks) <= 3:
        return None
    used_inputs = [s for s in inputs if use[s] > 0]
    if len(used_inputs) < 2:
        return None
    rename: dict[str, str] = {}
    taken: set[str] = set()
    for s in sinks:
        rename[s] = _out_name(rng, taken)
        taken.add(rename[s])
    for dev in devices:
        dev.pins = {t: rename.get(n, n) for t, n in dev.pins.items()}
    return Circuit("gate", f"gates{n_gates}", used_inputs, [rename[s] for s in sinks], devices=devices)


def sample_circuit(rng: np.random.Generator, domain: str) -> Circuit:
    """
    Sample a circuit for the requested domain.

    Args:
        rng: Random generator.
        domain: "transistor" or "gate".
    Returns:
        A circuit with devices and a computable truth table.
    Raises:
        ValueError: If the domain is unknown.
    """
    if domain == "transistor":
        return sample_transistor_circuit(rng)
    if domain == "gate":
        return sample_gate_circuit(rng)
    raise ValueError(f"unknown domain {domain!r}")


def topology_hash(circuit: Circuit) -> str:
    """
    Isomorphism-invariant hash of the logical circuit (devices, nets, port roles).

    Drawing-only choices (supply symbol count, bulk terminals, net and device names, layout)
    do not change the hash, so every rendering of the same circuit lands in the same split.

    Args:
        circuit: Circuit with devices.
    Returns:
        Hex digest string.
    """
    g = nx.Graph()
    role: dict[str, str] = {}
    for name in circuit.inputs:
        role[name] = "pi"
    for name in circuit.outputs:
        role[name] = "po"
    role[VDD_NET] = "vdd"
    role[GND_NET] = "gnd"
    for dev in circuit.devices:
        g.add_node(f"dev:{dev.id}", label=dev.cls)
        for term, net in dev.pins.items():
            if term == "b":
                continue
            g.add_node(f"net:{net}", label=role.get(net, "net"))
            g.add_edge(f"dev:{dev.id}", f"net:{net}", label=term)
    wl = nx.weisfeiler_lehman_graph_hash(g, node_attr="label", edge_attr="label", iterations=4)
    return hashlib.sha256(f"{circuit.domain}|{wl}".encode()).hexdigest()[:16]
