"""
Module: router.py
Purpose: Orthogonal grid maze router that draws every net of a placed schematic as a tree
         of wires. Different nets may only cross at right angles (a crossover without a dot);
         they never share a segment, a bend or a branch point. Same-net branch points become
         junction dots. This keeps the rendered drawing an exact picture of the netlist, so
         net ground truth (and junction vs crossover labels) is correct by construction.
"""

from __future__ import annotations

import heapq
from dataclasses import dataclass, field

# Direction index -> (dx, dy). Bit for direction i is 1 << i.
DIRS: tuple[tuple[int, int], ...] = ((1, 0), (0, 1), (-1, 0), (0, -1))
DIR_INDEX: dict[tuple[int, int], int] = {d: i for i, d in enumerate(DIRS)}
VERTICAL_BITS = (1 << 1) | (1 << 3)
HORIZONTAL_BITS = (1 << 0) | (1 << 2)

STEP_COST = 10
BEND_COST = 25
CROSS_COST = 40
NEAR_COST = 6


@dataclass
class RoutedNet:
    """Wiring of one drawn net: polylines, junction points and crossing points."""

    key: int
    polylines: list[list[tuple[int, int]]] = field(default_factory=list)
    junctions: list[tuple[int, int]] = field(default_factory=list)


class RoutingError(Exception):
    """Raised when a net cannot be routed on the grid."""


class GridRouter:
    """Maze router over a w x h integer grid with symbol obstacles and reserved pin exits."""

    def __init__(self, w: int, h: int) -> None:
        """
        Create an empty grid.

        Args:
            w: Grid width in cells.
            h: Grid height in cells.
        """
        self.w = w
        self.h = h
        n = w * h
        self.blocked = bytearray(n)
        self.reserve = [-1] * n
        self.owner = [-1] * n
        self.mask = [0] * n
        self.cross_net: dict[int, int] = {}
        self.cross_mask: dict[int, int] = {}
        self.pin_net: dict[int, int] = {}
        self.pin_dir: dict[int, int] = {}

    def idx(self, x: int, y: int) -> int:
        """
        Flat index of a grid point.

        Args:
            x: Column.
            y: Row.
        Returns:
            y * w + x.
        """
        return y * self.w + x

    def add_symbol(self, footprint: tuple[int, int, int, int], pins: list[tuple[tuple[int, int], tuple[int, int], int]]) -> None:
        """
        Block a symbol body (plus a one-cell ring) and register its pins.

        Args:
            footprint: (x0, y0, x1, y1) inclusive integer bounds of the symbol drawing.
            pins: (point, outward direction, net key) per pin.
        Raises:
            RoutingError: If the symbol is off-grid.
        """
        x0, y0, x1, y1 = footprint
        if x0 - 1 < 0 or y0 - 1 < 0 or x1 + 1 >= self.w or y1 + 1 >= self.h:
            raise RoutingError("symbol outside grid")
        for y in range(y0 - 1, y1 + 2):
            for x in range(x0 - 1, x1 + 2):
                self.blocked[self.idx(x, y)] = 1
        for (px, py), (dx, dy), key in pins:
            p = self.idx(px, py)
            if p in self.pin_net:
                raise RoutingError("two pins on one grid point")
            self.pin_net[p] = key
            self.pin_dir[p] = DIR_INDEX[(dx, dy)]
            ox, oy = px + dx, py + dy
            if not (0 <= ox < self.w and 0 <= oy < self.h):
                raise RoutingError("pin exit outside grid")
            o = self.idx(ox, oy)
            self.reserve[o] = key if self.reserve[o] in (-1, key) else -2

    def _enter(self, q: int, d: int, key: int, target_pin: int) -> int:
        """
        Classify moving into cell q along direction d for net `key`.

        Args:
            q: Destination cell.
            d: Move direction index.
            key: Net being routed.
            target_pin: Pin cell that ends the search, or -1 to target the net's existing tree.
        Returns:
            0 blocked, 1 free, 2 perpendicular crossing of another net, 3 target reached.
        """
        if q in self.pin_net:
            if q == target_pin and (d + 2) % 4 == self.pin_dir[q]:
                return 3
            return 0
        r = self.reserve[q]
        if r == -2 or (r >= 0 and r != key):
            return 0
        if self.blocked[q] and r != key:
            return 0
        o = self.owner[q]
        if o == -1:
            return 1
        if o == key:
            if target_pin >= 0 or q in self.cross_net:
                return 0
            m = self.mask[q]
            if m & (1 << ((d + 2) % 4)) or bin(m).count("1") >= 4:
                return 0
            return 3
        if q in self.cross_net:
            return 0
        need = VERTICAL_BITS if d in (0, 2) else HORIZONTAL_BITS
        return 2 if self.mask[q] == need else 0

    def _near_other(self, q: int, key: int) -> bool:
        """
        Whether a cell touches (4-neighbourhood) a wire of another net.

        Args:
            q: Cell index.
            key: Net being routed.
        Returns:
            True if a neighbour is owned by a different net.
        """
        x, y = q % self.w, q // self.w
        for dx, dy in DIRS:
            nx_, ny_ = x + dx, y + dy
            if 0 <= nx_ < self.w and 0 <= ny_ < self.h:
                o = self.owner[self.idx(nx_, ny_)]
                if o != -1 and o != key:
                    return True
        return False

    def _search(self, key: int, src: int, target_pin: int, tree_box: tuple[int, int, int, int]) -> list[int]:
        """
        A* from a pin (leaving along its exit direction) to the target.

        Args:
            key: Net key.
            src: Source pin cell.
            target_pin: Target pin cell, or -1 to stop at any legal point of the net's tree.
            tree_box: (x0, y0, x1, y1) bounds of the targets for the heuristic.
        Returns:
            Cell path from src to the reached target.
        Raises:
            RoutingError: If unreachable.
        """
        w = self.w
        tx0, ty0, tx1, ty1 = tree_box

        def heur(q: int) -> int:
            """Manhattan distance from q to the target bounding box, in step-cost units."""
            x, y = q % w, q // w
            dx = tx0 - x if x < tx0 else (x - tx1 if x > tx1 else 0)
            dy = ty0 - y if y < ty0 else (y - ty1 if y > ty1 else 0)
            return (dx + dy) * STEP_COST

        d0 = self.pin_dir[src]
        sx, sy = src % w, src // w
        ex, ey = sx + DIRS[d0][0], sy + DIRS[d0][1]
        if not (0 <= ex < w and 0 <= ey < self.h):
            raise RoutingError("pin exit off grid")
        first = self.idx(ex, ey)
        status = self._enter(first, d0, key, target_pin)
        if status == 0:
            raise RoutingError("pin exit blocked")
        if status == 3:
            return [src, first]
        start = (first, d0)
        g_cost: dict[tuple[int, int], int] = {start: STEP_COST}
        parent: dict[tuple[int, int], tuple[int, int] | None] = {start: None}
        heap: list[tuple[int, int, int, int]] = [(STEP_COST + heur(first), STEP_COST, first, d0)]
        crossing_state: set[tuple[int, int]] = set()
        if status == 2:
            crossing_state.add(start)
        while heap:
            _, g, p, d = heapq.heappop(heap)
            if g != g_cost.get((p, d)):
                continue
            px, py = p % w, p // w
            options = (d,) if (p, d) in crossing_state else (d, (d + 1) % 4, (d + 3) % 4)
            for nd in options:
                qx, qy = px + DIRS[nd][0], py + DIRS[nd][1]
                if not (0 <= qx < w and 0 <= qy < self.h):
                    continue
                q = qy * w + qx
                st = self._enter(q, nd, key, target_pin)
                if st == 0:
                    continue
                cost = g + STEP_COST + (BEND_COST if nd != d else 0)
                if st == 2:
                    cost += CROSS_COST
                elif st == 1 and self._near_other(q, key):
                    cost += NEAR_COST
                state = (q, nd)
                if st == 3:
                    path = [q]
                    cur: tuple[int, int] | None = (p, d)
                    while cur is not None:
                        path.append(cur[0])
                        cur = parent[cur]
                    path.append(src)
                    path.reverse()
                    if len(set(path)) != len(path):
                        raise RoutingError("self-intersecting path")
                    return path
                if cost < g_cost.get(state, 1 << 60):
                    g_cost[state] = cost
                    parent[state] = (p, d)
                    if st == 2:
                        crossing_state.add(state)
                    heapq.heappush(heap, (cost + heur(q), cost, q, nd))
        raise RoutingError("no route")

    def _commit(self, key: int, path: list[int]) -> None:
        """
        Record a found path as wire edges of net `key`.

        Args:
            key: Net key.
            path: Cells from source pin to target.
        """
        w = self.w
        for a, b in zip(path[:-1], path[1:]):
            d = DIR_INDEX[(b % w - a % w, b // w - a // w)]
            for cell, bit in ((a, 1 << d), (b, 1 << ((d + 2) % 4))):
                o = self.owner[cell]
                if o in (-1, key):
                    self.owner[cell] = key
                    self.mask[cell] |= bit
                else:
                    self.cross_net[cell] = key
                    self.cross_mask[cell] = self.cross_mask.get(cell, 0) | bit

    def route_net(self, key: int, pins: list[int]) -> None:
        """
        Route one net as a tree: connect pins one by one to the growing tree.

        Args:
            key: Net key (all pins must be registered with it).
            pins: Pin cells, first one is the tree root.
        Raises:
            RoutingError: If any pin cannot be connected.
        """
        w = self.w
        root = pins[0]
        remaining = list(pins[1:])
        tree_pts = [root]
        connected_once = False
        while remaining:
            xs = [p % w for p in tree_pts]
            ys = [p // w for p in tree_pts]
            box = (min(xs), min(ys), max(xs), max(ys))
            remaining.sort(key=lambda p: (abs(p % w - (box[0] + box[2]) / 2) + abs(p // w - (box[1] + box[3]) / 2), p))
            nxt = remaining.pop(0)
            target = -1 if connected_once else root
            path = self._search(key, nxt, target, box)
            self._commit(key, path)
            tree_pts.extend(path)
            connected_once = True

    def extract(self, key: int) -> RoutedNet:
        """
        Turn the committed edges of a net into polylines and junction points.

        Args:
            key: Net key.
        Returns:
            RoutedNet with maximal polylines (vertices at bends, junctions and ends only).
        """
        w = self.w
        adj: dict[int, list[int]] = {}
        cells = [c for c in range(w * self.h) if self.owner[c] == key] + [c for c, k in self.cross_net.items() if k == key]
        for c in cells:
            bits = self.mask[c] if self.owner[c] == key else self.cross_mask[c]
            x, y = c % w, c // w
            adj[c] = [self.idx(x + DIRS[i][0], y + DIRS[i][1]) for i in range(4) if bits & (1 << i)]
        net = RoutedNet(key)
        node_cells = sorted(c for c, nb in adj.items() if len(nb) != 2 or c in self.pin_net)
        node_set = set(node_cells)
        net.junctions = [(c % w, c // w) for c in node_cells if len(adj[c]) >= 3]
        seen_edges: set[tuple[int, int]] = set()
        for start in node_cells:
            for nb in sorted(adj[start]):
                if (start, nb) in seen_edges:
                    continue
                chain = [start, nb]
                seen_edges.add((start, nb))
                seen_edges.add((nb, start))
                while chain[-1] not in node_set:
                    cur = chain[-1]
                    nxt = [c for c in adj[cur] if c != chain[-2]][0]
                    seen_edges.add((cur, nxt))
                    seen_edges.add((nxt, cur))
                    chain.append(nxt)
                net.polylines.append(_simplify([(c % w, c // w) for c in chain]))
        return net

    def crossings(self) -> list[tuple[tuple[int, int], int, int]]:
        """
        All perpendicular crossings of two nets.

        Returns:
            (point, first net key, second net key) per crossing, sorted by cell.
        """
        return [((c % self.w, c // self.w), self.owner[c], k) for c, k in sorted(self.cross_net.items())]


def _simplify(points: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """
    Drop collinear interior vertices of an orthogonal polyline.

    Args:
        points: Grid points along the polyline.
    Returns:
        Polyline with only end and bend vertices.
    """
    out = [points[0]]
    for i in range(1, len(points) - 1):
        a, b, c = out[-1], points[i], points[i + 1]
        if (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) != 0:
            out.append(b)
    out.append(points[-1])
    return out
