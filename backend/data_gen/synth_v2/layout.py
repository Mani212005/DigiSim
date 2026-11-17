"""
Module: layout.py
Purpose: Places the symbols of a sampled circuit on an integer grid the way a textbook would
         draw it, then routes every net with the grid router. Transistor circuits use the
         classic CMOS picture (pull-up network on top, pull-down below, series stacks vertical,
         parallel branches side by side, transmission gates horizontal); gate circuits use a
         left-to-right layered layout. Supply symbols (shared rail, per stage or per device)
         and I/O port symbols are added here, and an optional global rotation/mirror varies
         symbol orientation. The result is an exact geometric netlist ready for rendering.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field, replace

import numpy as np

from .logic import GND_NET, VDD_NET, Circuit, SPNode, Stage
from .router import GridRouter, RoutedNet, RoutingError
from .symbols import GridPoint, compose_orientation, orient_grid, orient_points, orientation_for, symbol_geometry

BORDER = 5
MAX_GRID = 84
# Symbol variant reserved for held-out-style test samples (never drawn in train/valid).
HELD_OUT_VDD_VARIANT = "circle"


class LayoutError(Exception):
    """Raised when a circuit cannot be laid out or routed within the size limits."""


@dataclass
class PlacedSymbol:
    """One symbol instance on the grid with its orientation and terminal-to-net map."""

    comp_id: str
    cls: str
    variant: str
    rotation: int
    mirror: bool
    anchor: GridPoint
    nets: dict[str, str]
    label: str = ""

    def pins(self) -> dict[str, GridPoint]:
        """
        World grid position of every pin.

        Returns:
            Terminal name to grid point.
        """
        geom = symbol_geometry(self.cls, self.variant)
        out = {}
        for name, p in geom.pins.items():
            dx, dy = orient_grid(p, self.rotation, self.mirror)
            out[name] = (self.anchor[0] + dx, self.anchor[1] + dy)
        return out

    def pin_dirs(self) -> dict[str, GridPoint]:
        """
        World outward direction of every pin.

        Returns:
            Terminal name to unit direction.
        """
        geom = symbol_geometry(self.cls, self.variant)
        return {name: orient_grid(d, self.rotation, self.mirror) for name, d in geom.pin_dirs.items()}

    def world_points(self) -> np.ndarray:
        """
        All stroke and fill vertices in world grid units (float).

        Returns:
            Nx2 array.
        """
        geom = symbol_geometry(self.cls, self.variant)
        pts = np.concatenate(list(geom.strokes) + list(geom.fills), axis=0)
        return orient_points(pts, self.rotation, self.mirror) + np.array(self.anchor, dtype=np.float64)

    def footprint(self) -> tuple[int, int, int, int]:
        """
        Inclusive integer bounds of the drawing (pins lie on the boundary).

        Returns:
            (x0, y0, x1, y1).
        """
        pts = self.world_points()
        lo = np.floor(pts.min(axis=0) + 1e-9).astype(int)
        hi = np.ceil(pts.max(axis=0) - 1e-9).astype(int)
        return int(lo[0]), int(lo[1]), int(hi[0]), int(hi[1])

    def transformed(self, rotation: int, mirror: bool) -> PlacedSymbol:
        """
        Copy of the symbol after a global orientation about the grid origin.

        Args:
            rotation: Global rotation in degrees clockwise.
            mirror: Global mirror applied before the rotation.
        Returns:
            New PlacedSymbol.
        """
        rot, mir = compose_orientation((self.rotation, self.mirror), (rotation, mirror))
        return replace(self, rotation=rot, mirror=mir, anchor=orient_grid(self.anchor, rotation, mirror))


@dataclass
class Layout:
    """Placed and routed drawing in grid units."""

    domain: str
    symbols: list[PlacedSymbol]
    width: int
    height: int
    nets: list[RoutedNet] = field(default_factory=list)
    key_net: dict[int, str] = field(default_factory=dict)
    crossings: list[tuple[GridPoint, str, str]] = field(default_factory=list)
    global_orientation: tuple[int, bool] = (0, False)


@dataclass
class DrawStyle:
    """Layout-level style choices (symbol variants, supply style, spacing)."""

    nmos: str = "plain3"
    pmos: str = "bubble3"
    vdd: str = "bar"
    gnd: str = "bars"
    in_port: str = "tag"
    out_port: str = "tag"
    gate: str = "ansi"
    supply: str = "shared"  # shared | per_stage | per_device
    mirror_transistors: bool = False
    global_rotation: int = 0
    global_mirror: bool = False


def sample_draw_style(rng: np.random.Generator, domain: str, held_out: bool) -> DrawStyle:
    """
    Sample consistent per-image symbol variants and layout options.

    Args:
        rng: Random generator.
        domain: "transistor" or "gate".
        held_out: Use the held-out VDD symbol variant (test split only); otherwise never use it.
    Returns:
        DrawStyle.
    """
    pairs = (("plain3", "bubble3"), ("arrow3", "arrow3"), ("dashed3", "bubble3"), ("plain3", "arrow3"), ("body4", "body4"), ("body4", "bubble4"))
    weights = np.array([0.3, 0.15, 0.1, 0.1, 0.2, 0.15])
    nmos, pmos = pairs[int(rng.choice(len(pairs), p=weights / weights.sum()))]
    style = DrawStyle(
        nmos=nmos,
        pmos=pmos,
        vdd=HELD_OUT_VDD_VARIANT if held_out else ("bar", "arrow")[int(rng.integers(0, 2))],
        gnd=("bars", "triangle", "filled")[int(rng.integers(0, 3))],
        in_port=("tag", "arrow")[int(rng.integers(0, 2))],
        out_port=("tag", "arrow")[int(rng.integers(0, 2))],
        gate="iec" if rng.random() < 0.15 else "ansi",
        supply=("shared", "per_stage", "per_device")[int(rng.choice(3, p=[0.3, 0.2, 0.5]))],
        mirror_transistors=bool(rng.random() < 0.3),
    )
    p_rot = 0.2 if domain == "transistor" else 0.1
    if rng.random() < p_rot:
        style.global_rotation = int(rng.choice([90, 180, 270]))
        style.global_mirror = bool(rng.random() < 0.5)
    return style


# ---------------------------------------------------------------------------------------------
# Transistor-level placement
# ---------------------------------------------------------------------------------------------


def _place_sp(node: SPNode, mirror: bool) -> tuple[list[tuple[str, int, int]], int, int, bool, bool]:
    """
    Recursive textbook placement of a series-parallel network.

    Leaves are 4 columns by 4 rows (top pin row 0, bottom pin row 4). Series children stack
    vertically, parallel children sit side by side with routing channels between them.

    Args:
        node: Series-parallel tree.
        mirror: Whether transistors are mirrored (gate on the right).
    Returns:
        (items as (device_id, anchor_x, anchor_y), width, bottom_row, top_is_multi, bottom_is_multi).
    """
    if node.kind == "leaf":
        return [(node.device_id, 1 if mirror else 2, 2)], 4, 4, False, False
    placed = [_place_sp(child, mirror) for child in node.children]
    items: list[tuple[str, int, int]] = []
    if node.kind == "series":
        width = max(p[1] for p in placed)
        y = 0
        for i, (sub, w, h, _, bm) in enumerate(placed):
            dx = (width - w) // 2
            items += [(d, x + dx, yy + y) for d, x, yy in sub]
            if i + 1 < len(placed):
                y += h + (4 if bm or placed[i + 1][3] else 2)
            else:
                y += h
        return items, width, y, placed[0][3], placed[-1][4]
    x = 0
    for sub, w, _, _, _ in placed:
        items += [(d, xx + x, yy) for d, xx, yy in sub]
        x += w + 4
    return items, x - 4, max(p[2] for p in placed), True, True


def _layout_transistor(circuit: Circuit, style: DrawStyle, rng: np.random.Generator) -> list[PlacedSymbol]:
    """
    Place transistors, ports and supplies for a CMOS circuit (canonical frame, before global transform).

    Args:
        circuit: Transistor-domain circuit with devices.
        style: Drawing style.
        rng: Random generator.
    Returns:
        Placed symbols.
    """
    devs = {d.id: d for d in circuit.devices}
    symbols: list[PlacedSymbol] = []
    mirror = style.mirror_transistors
    stage_x = 0
    mid_rows: dict[str, int] = {}
    stage_bounds: list[tuple[int, int, int]] = []
    body = style.nmos == "body4"

    def add_mos(dev_id: str, ax: int, ay: int, rotation: int, mir: bool) -> None:
        """Add one transistor symbol, wiring its bulk to the matching supply when drawn."""
        dev = devs[dev_id]
        variant = style.nmos if dev.cls == "NMOS" else style.pmos
        nets = dict(dev.pins)
        if variant in ("body4", "bubble4"):
            nets["b"] = GND_NET if dev.cls == "NMOS" else VDD_NET
        symbols.append(PlacedSymbol(dev_id, dev.cls, variant, rotation, mir, (ax, ay), nets))

    for stage in circuit.stages:
        if stage.kind == "cmos":
            pun = _place_sp(stage.pun, mirror)
            pdn = _place_sp(stage.pdn, mirror)
            width = max(pun[1], pdn[1])
            y_pdn = pun[2] + 6
            for items, y0, w in ((pun[0], 0, pun[1]), (pdn[0], y_pdn, pdn[1])):
                dx = stage_x + (width - w) // 2
                for dev_id, x, y in items:
                    add_mos(dev_id, x + dx, y + y0, 0, mirror)
            mid_rows[stage.out] = pun[2] + 3
            height = y_pdn + pdn[2]
        else:
            _place_tg_mux(stage, stage_x, body, add_mos)
            width = 5
            s = 6 if body else 4
            mid_rows[stage.out] = 2 + s + 4
            height = 2 + 2 * s + 8 + 2
        stage_bounds.append((stage_x, width, height))
        stage_x += width + 7

    total_h = max(b[2] for b in stage_bounds)
    in_variant, out_variant = style.in_port, style.out_port
    n_in = len(circuit.inputs)
    rows = _spread_rows(n_in, 2, total_h - 2, 3)
    order = list(range(n_in))
    for name, row in zip([circuit.inputs[i] for i in order], rows):
        symbols.append(PlacedSymbol(f"IN_{name}", "INPUT_PORT", in_variant, 0, False, (-6, row), {"out": name}, label=name))
    right = stage_x - 7 + 6
    used_rows: list[int] = []
    for name in circuit.outputs:
        row = mid_rows.get(name, total_h // 2)
        while any(abs(row - r) < 3 for r in used_rows):
            row += 3
        used_rows.append(row)
        symbols.append(PlacedSymbol(f"OUT_{name}", "OUTPUT_PORT", out_variant, 0, False, (right, row), {"a": name}, label=name))
    _add_supplies(symbols, style, stage_bounds, rng)
    return symbols


def _place_tg_mux(stage: Stage, x0: int, body: bool, add_mos: Callable[[str, int, int, int, bool], None]) -> None:
    """
    Place the four transistors of a transmission-gate 2:1 mux as two horizontal TGs.

    Each TG is an NMOS (gate up) above a PMOS (gate down); sources face left (data), drains
    face right (output).

    Args:
        stage: The tg_mux stage (tg_devices = [N_A, P_A, N_B, P_B]).
        x0: Left column of the stage.
        body: Whether 4-terminal symbols are drawn (needs more vertical room).
        add_mos: Callback (device_id, x, y, rotation, mirror) that adds a transistor.
    """
    s = 6 if body else 4
    cx = x0 + 2
    n_rot = orientation_for("NMOS", "plain3", "g", (0, -1))
    p_rot = orientation_for("PMOS", "bubble3", "g", (0, 1))
    y_a = 2
    y_b = y_a + s + 8
    n_a, p_a, n_b, p_b = stage.tg_devices
    add_mos(n_a, cx, y_a, n_rot, False)
    add_mos(p_a, cx, y_a + s, p_rot, False)
    add_mos(n_b, cx, y_b, n_rot, False)
    add_mos(p_b, cx, y_b + s, p_rot, False)


def _spread_rows(n: int, lo: int, hi: int, min_gap: int) -> list[int]:
    """
    Evenly spread n rows over [lo, hi] keeping a minimum gap.

    Args:
        n: Number of rows.
        lo: Lowest row.
        hi: Highest row.
        min_gap: Minimum distance between consecutive rows.
    Returns:
        Sorted list of rows.
    """
    span = max(hi - lo, (n - 1) * min_gap)
    if n == 1:
        return [lo + span // 2]
    return [lo + round(i * span / (n - 1)) for i in range(n)]


def _cells(footprint: tuple[int, int, int, int], ring: int = 1) -> set[GridPoint]:
    """
    Grid cells covered by a footprint plus a ring.

    Args:
        footprint: (x0, y0, x1, y1).
        ring: Ring width.
    Returns:
        Set of cells.
    """
    x0, y0, x1, y1 = footprint
    return {(x, y) for x in range(x0 - ring, x1 + ring + 1) for y in range(y0 - ring, y1 + ring + 1)}


def _add_supplies(symbols: list[PlacedSymbol], style: DrawStyle, stage_bounds: list[tuple[int, int, int]], rng: np.random.Generator) -> None:
    """
    Add VDD and GND symbols in the chosen supply style.

    Args:
        symbols: Placed symbols (extended in place).
        style: Drawing style (supply style and variants).
        stage_bounds: (x, width, height) per stage.
        rng: Random generator.
    """
    occupied: set[GridPoint] = set()
    for sym in symbols:
        occupied |= _cells(sym.footprint())
    top = min(sym.footprint()[1] for sym in symbols)
    bottom = max(sym.footprint()[3] for sym in symbols)
    for net, cls, variant, out_dir in ((VDD_NET, "VDD", style.vdd, (0, -1)), (GND_NET, "GND", style.gnd, (0, 1))):
        pin_name = "pos" if cls == "VDD" else "gnd"
        supply_pins: list[GridPoint] = []
        facing: list[GridPoint] = []
        for sym in symbols:
            dirs = sym.pin_dirs()
            for term, p in sym.pins().items():
                if sym.nets.get(term) == net:
                    supply_pins.append(p)
                    if dirs[term] == out_dir:
                        facing.append(p)
        if not supply_pins:
            continue
        anchors: list[GridPoint] = []
        if style.supply == "per_device":
            for px, py in sorted(facing):
                cand = (px, py + 3 * out_dir[1])
                sym = PlacedSymbol("", cls, variant, 0, False, cand, {pin_name: net})
                cells = _cells(sym.footprint())
                if not cells & occupied:
                    anchors.append(cand)
                    occupied |= cells
        elif style.supply == "per_stage":
            for x, w, _ in stage_bounds:
                in_stage = [p for p in (facing or supply_pins) if x <= p[0] < x + w]
                if in_stage:
                    px = sorted(in_stage)[0][0]
                    anchors.append((px, top - 4 if cls == "VDD" else bottom + 4))
        if not anchors:
            px = sorted(facing or supply_pins)[0][0]
            anchors.append((px, top - 4 if cls == "VDD" else bottom + 4))
        for i, a in enumerate(anchors):
            symbols.append(PlacedSymbol(f"{cls}{i + 1}", cls, variant, 0, False, a, {pin_name: net}, label=cls))


# ---------------------------------------------------------------------------------------------
# Gate-level placement
# ---------------------------------------------------------------------------------------------


def _layout_gate(circuit: Circuit, style: DrawStyle, rng: np.random.Generator) -> list[PlacedSymbol]:
    """
    Layered left-to-right placement of a gate-level DAG with ports.

    Args:
        circuit: Gate-domain circuit.
        style: Drawing style.
        rng: Random generator.
    Returns:
        Placed symbols.
    """
    depth: dict[str, int] = {s: 0 for s in circuit.inputs}
    for dev in circuit.devices:
        depth[dev.pins["out"]] = 1 + max(depth[dev.pins[t]] for t in ("a", "b") if t in dev.pins)
    max_d = max(depth.values())
    colw = int(rng.integers(10, 13))
    si = int(rng.integers(4, 7))
    sg = int(rng.integers(7, 10))
    row: dict[str, float] = {}
    symbols: list[PlacedSymbol] = []
    for i, name in enumerate(circuit.inputs):
        row[name] = i * si
        symbols.append(PlacedSymbol(f"IN_{name}", "INPUT_PORT", style.in_port, 0, False, (0, i * si), {"out": name}, label=name))
    for d in range(1, max_d + 1):
        col = [dev for dev in circuit.devices if depth[dev.pins["out"]] == d]
        bary = {dev.id: float(np.mean([row[dev.pins[t]] for t in ("a", "b") if t in dev.pins])) + rng.uniform(-1, 1) for dev in col}
        col.sort(key=lambda dev: (bary[dev.id], dev.id))
        start = round(float(np.mean(list(bary.values()))) - (len(col) - 1) * sg / 2)
        for i, dev in enumerate(col):
            r = start + i * sg
            row[dev.pins["out"]] = r
            symbols.append(PlacedSymbol(dev.id, dev.cls, style.gate, 0, False, (d * colw, r), dict(dev.pins)))
    out_x = max_d * colw + 9
    for name in circuit.outputs:
        symbols.append(PlacedSymbol(f"OUT_{name}", "OUTPUT_PORT", style.out_port, 0, False, (out_x, int(row[name])), {"a": name}, label=name))
    return symbols


# ---------------------------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------------------------


def build_layout(circuit: Circuit, style: DrawStyle, rng: np.random.Generator) -> Layout:
    """
    Place, orient, normalise and route a circuit.

    Args:
        circuit: Sampled circuit with devices.
        style: Drawing style.
        rng: Random generator.
    Returns:
        Fully routed Layout.
    Raises:
        LayoutError: If the drawing exceeds MAX_GRID or cannot be routed.
    """
    if circuit.domain == "transistor":
        symbols = _layout_transistor(circuit, style, rng)
    else:
        symbols = _layout_gate(circuit, style, rng)
    rot, mir = style.global_rotation, style.global_mirror
    if rot or mir:
        symbols = [s.transformed(rot, mir) for s in symbols]
    fps = [s.footprint() for s in symbols]
    min_x = min(f[0] for f in fps)
    min_y = min(f[1] for f in fps)
    shift = (BORDER - min_x, BORDER - min_y)
    symbols = [replace(s, anchor=(s.anchor[0] + shift[0], s.anchor[1] + shift[1])) for s in symbols]
    fps = [s.footprint() for s in symbols]
    width = max(f[2] for f in fps) + BORDER + 1
    height = max(f[3] for f in fps) + BORDER + 1
    if width > MAX_GRID or height > MAX_GRID:
        raise LayoutError(f"layout {width}x{height} exceeds {MAX_GRID}")
    layout = Layout(circuit.domain, symbols, width, height, global_orientation=(rot, mir))
    _route(layout, rng)
    return layout


def _drawn_nets(symbols: list[PlacedSymbol]) -> tuple[dict[tuple[str, str], int], dict[int, str], dict[int, list[GridPoint]]]:
    """
    Split logical nets into drawn nets (one per supply symbol for supply nets).

    Args:
        symbols: Placed symbols.
    Returns:
        (pin (comp_id, terminal) -> key, key -> logical net, key -> pin points with the root first).
    """
    supply_syms = [s for s in symbols if s.cls in ("VDD", "GND")]
    key_of_net: dict[str, int] = {}
    key_net: dict[int, str] = {}
    pin_key: dict[tuple[str, str], int] = {}
    key_pins: dict[int, list[GridPoint]] = {}
    sym_key: dict[str, int] = {}
    for s in supply_syms:
        k = len(key_net)
        key_net[k] = next(iter(s.nets.values()))
        sym_key[s.comp_id] = k
    for sym in symbols:
        pins = sym.pins()
        for term, net in sorted(sym.nets.items()):
            p = pins[term]
            if sym.comp_id in sym_key:
                k = sym_key[sym.comp_id]
            elif net in (VDD_NET, GND_NET):
                cands = [s for s in supply_syms if next(iter(s.nets.values())) == net]
                best = min(cands, key=lambda s: (abs(s.pins()[next(iter(s.nets))][0] - p[0]) + abs(s.pins()[next(iter(s.nets))][1] - p[1]), s.comp_id))
                k = sym_key[best.comp_id]
            else:
                if net not in key_of_net:
                    key_of_net[net] = len(key_net)
                    key_net[key_of_net[net]] = net
                k = key_of_net[net]
            pin_key[(sym.comp_id, term)] = k
            key_pins.setdefault(k, [])
            if sym.comp_id in sym_key or sym.cls in ("INPUT_PORT",):
                key_pins[k].insert(0, p)
            else:
                key_pins[k].append(p)
    return pin_key, key_net, key_pins


def _route(layout: Layout, rng: np.random.Generator) -> None:
    """
    Route every drawn net; retries with shuffled net orders before giving up.

    Args:
        layout: Layout to fill with nets and crossings.
        rng: Random generator.
    Raises:
        LayoutError: When routing fails for every attempted order.
    """
    pin_key, key_net, key_pins = _drawn_nets(layout.symbols)
    single = [k for k, pins in key_pins.items() if len(pins) < 2]
    if single:
        raise LayoutError("net with a single pin")

    def span(k: int) -> int:
        """Half-perimeter of a drawn net's pin bounding box."""
        xs = [p[0] for p in key_pins[k]]
        ys = [p[1] for p in key_pins[k]]
        return (max(xs) - min(xs)) + (max(ys) - min(ys))

    base_order = sorted(key_pins, key=lambda k: (span(k), k))
    for attempt in range(4):
        order = base_order if attempt == 0 else [base_order[i] for i in rng.permutation(len(base_order))]
        router = GridRouter(layout.width, layout.height)
        try:
            for sym in layout.symbols:
                pins, dirs = sym.pins(), sym.pin_dirs()
                router.add_symbol(sym.footprint(), [(pins[t], dirs[t], pin_key[(sym.comp_id, t)]) for t in sorted(sym.nets)])
            for k in order:
                router.route_net(k, [router.idx(x, y) for x, y in key_pins[k]])
        except RoutingError:
            continue
        layout.nets = [router.extract(k) for k in sorted(key_pins)]
        layout.key_net = key_net
        layout.crossings = [(p, key_net[a], key_net[b]) for p, a, b in router.crossings()]
        return
    raise LayoutError("routing failed")
