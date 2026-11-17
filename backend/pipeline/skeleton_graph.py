"""
Module: skeleton_graph.py
Purpose: Turns the wire ink (symbol bodies already erased) into a pixel graph and resolves it
         into electrical connectivity, classical CV only. The skeleton is split into node
         clusters (groups of nearby branch points) and edges (the wire runs between them).
         A cluster touching a detected junction dot box is a forced connection; clusters are
         never grown to the dot's extent, so a crossover drawn just beside a dot stays one. Connectivity rules at a cluster:
           - a cluster under a JUNCTION detection always connects all its wires;
           - a 4-way cluster without a junction is a crossover: the wires are paired by
             straightness and only the straight-through pairs connect;
           - any other cluster (T, L, kink) connects all its wires.
         Short dangling spurs (thinning artefacts of dots and blobs) are ignored when counting
         a cluster's wires.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import combinations

import cv2
import numpy as np
from skimage.morphology import skeletonize

from pipeline.trace_types import Box, Point

_NEIGHBOUR_KERNEL = np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]], dtype=np.float32)
_OFFSETS: tuple[tuple[int, int], ...] = tuple((dy, dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx)
# Both wire pairs of a crossover must be at least this straight (cosine of the pair angle <= -value).
CROSSOVER_MIN_STRAIGHTNESS = 0.6


class UnionFind:
    """Union-find over integer ids with path halving."""

    def __init__(self, n: int) -> None:
        """
        Create n singleton sets.

        Args:
            n: Number of elements.
        """
        self.parent = list(range(n))

    def find(self, a: int) -> int:
        """
        Root of a's set.

        Args:
            a: Element.
        Returns:
            Root element.
        """
        while self.parent[a] != a:
            self.parent[a] = self.parent[self.parent[a]]
            a = self.parent[a]
        return a

    def union(self, a: int, b: int) -> None:
        """
        Merge the sets of a and b.

        Args:
            a: First element.
            b: Second element.
        """
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


@dataclass
class Endpoint:
    """A free end of the skeleton (degree-1 pixel) and the wire leaving it."""

    point: Point  # (x, y)
    edge: int
    direction: Point  # unit vector from the endpoint along its wire


@dataclass
class SkeletonGraph:
    """Skeleton split into edges (wire runs) and clusters (branch points and junction dots)."""

    skeleton: np.ndarray
    edge_labels: np.ndarray  # int32, 0 = not an edge pixel, edge ids start at 1
    n_edges: int
    cluster_labels: np.ndarray  # int32, 0 = not a cluster pixel, cluster ids start at 1
    n_clusters: int
    cluster_forced: set[int]  # clusters under a detected junction dot
    incidence: dict[int, list[int]]  # cluster id -> incident edge ids (with multiplicity for loops)
    edge_pixels: dict[int, np.ndarray]  # edge id -> (n, 2) array of (x, y)
    cluster_centroids: dict[int, Point]
    endpoints: list[Endpoint] = field(default_factory=list)
    junction_groups: list[set[int]] = field(default_factory=list)  # cluster ids under each junction box


def skeleton_of(mask: np.ndarray) -> np.ndarray:
    """
    One-pixel-wide skeleton of a binary mask.

    Args:
        mask: Bool mask.
    Returns:
        Bool skeleton.
    """
    return skeletonize(mask)


def _group_pixels(labels: np.ndarray) -> dict[int, np.ndarray]:
    """
    Pixel coordinates per label.

    Args:
        labels: int32 label image (0 = background).
    Returns:
        Mapping label -> (n, 2) array of (x, y).
    """
    ys, xs = np.nonzero(labels)
    if ys.size == 0:
        return {}
    labs = labels[ys, xs]
    order = np.argsort(labs, kind="stable")
    labs, xs, ys = labs[order], xs[order], ys[order]
    bounds = np.flatnonzero(np.diff(labs)) + 1
    groups: dict[int, np.ndarray] = {}
    for chunk_l, chunk_x, chunk_y in zip(np.split(labs, bounds), np.split(xs, bounds), np.split(ys, bounds)):
        groups[int(chunk_l[0])] = np.stack([chunk_x, chunk_y], axis=1)
    return groups


def _neighbour_pairs(src: np.ndarray, dst: np.ndarray) -> set[tuple[int, int]]:
    """
    Label pairs (src label, dst label) of 8-adjacent pixels.

    Args:
        src: int32 label image.
        dst: int32 label image of the same shape.
    Returns:
        Set of (src label, dst label) with both labels > 0.
    """
    h, w = src.shape
    padded = np.pad(dst, 1)
    ys, xs = np.nonzero(src)
    pairs: set[tuple[int, int]] = set()
    if ys.size == 0:
        return pairs
    s = src[ys, xs]
    for dy, dx in _OFFSETS:
        d = padded[ys + 1 + dy, xs + 1 + dx]
        hit = d > 0
        if hit.any():
            pairs.update(zip(s[hit].tolist(), d[hit].tolist()))
    return pairs


def _direction(pixels: np.ndarray, origin: Point, reach: float) -> Point:
    """
    Unit direction from an origin toward the nearby part of a pixel run.

    Args:
        pixels: (n, 2) array of (x, y) pixels of one edge.
        origin: Reference point (cluster centroid or endpoint).
        reach: Only pixels within this distance are averaged (the nearest few when none are).
    Returns:
        Unit vector (dx, dy); (0, 0) when undefined.
    """
    d = np.hypot(pixels[:, 0] - origin[0], pixels[:, 1] - origin[1])
    near = pixels[d <= reach]
    if len(near) < 2:
        near = pixels[np.argsort(d)[: max(2, min(len(pixels), 6))]]
    v = near.mean(axis=0) - np.asarray(origin)
    n = float(np.hypot(v[0], v[1]))
    return (float(v[0] / n), float(v[1] / n)) if n > 1e-6 else (0.0, 0.0)


def build_skeleton_graph(mask: np.ndarray, junction_boxes: list[Box], merge_radius: float, reach: float) -> SkeletonGraph:
    """
    Skeletonise wire ink and split it into edges and node clusters.

    Args:
        mask: Bool wire-ink mask (symbol bodies erased).
        junction_boxes: Detected junction dot boxes (x1, y1, x2, y2); branch clusters touching one are forced
            connections, and several clusters under one box are joined.
        merge_radius: Branch pixels closer than this form one cluster (absorbs the short bridges of thick crossings).
        reach: Distance over which wire directions are measured.
    Returns:
        The SkeletonGraph.
    """
    skel = skeleton_of(mask)
    sk8 = skel.astype(np.uint8)
    nb = cv2.filter2D(sk8, cv2.CV_16S, _NEIGHBOUR_KERNEL, borderType=cv2.BORDER_CONSTANT)
    branch = skel & (nb >= 3)
    ends = skel & (nb == 1)
    h, w = skel.shape
    cluster_mask = np.zeros_like(skel)
    if branch.any():
        r = max(1, int(round(merge_radius)))
        region = cv2.dilate(branch.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
        cluster_mask |= skel & region.astype(bool)
    n_c, cluster_labels = cv2.connectedComponents(cluster_mask.astype(np.uint8), connectivity=8)
    edge_mask = skel & ~cluster_mask
    n_e, edge_labels = cv2.connectedComponents(edge_mask.astype(np.uint8), connectivity=8)
    cluster_labels = cluster_labels.astype(np.int32)
    edge_labels = edge_labels.astype(np.int32)
    edge_pixels = _group_pixels(edge_labels)
    cluster_pixels = _group_pixels(cluster_labels)
    centroids = {c: (float(p[:, 0].mean()), float(p[:, 1].mean())) for c, p in cluster_pixels.items()}
    # A cluster is under a dot when its centre is inside the dot box; touching the box is not enough, since
    # crossovers are often drawn within a dot diameter of a junction.
    groups: list[set[int]] = []
    for x1, y1, x2, y2 in junction_boxes:
        groups.append({c for c, (cx, cy) in centroids.items() if x1 <= cx <= x2 and y1 <= cy <= y2})
    forced = set().union(*groups) if groups else set()
    incidence: dict[int, list[int]] = {c: [] for c in cluster_pixels}
    for e, c in sorted(_neighbour_pairs(edge_labels, cluster_labels)):
        incidence[c].append(e)

    endpoints: list[Endpoint] = []
    eys, exs = np.nonzero(ends & edge_mask)
    for y, x in zip(eys.tolist(), exs.tolist()):
        e = int(edge_labels[y, x])
        endpoints.append(Endpoint(point=(float(x), float(y)), edge=e, direction=_direction(edge_pixels[e], (float(x), float(y)), reach)))
    return SkeletonGraph(
        skeleton=skel,
        edge_labels=edge_labels,
        n_edges=int(n_e - 1),
        cluster_labels=cluster_labels,
        n_clusters=int(n_c - 1),
        cluster_forced=forced,
        incidence=incidence,
        edge_pixels=edge_pixels,
        cluster_centroids=centroids,
        endpoints=endpoints,
        junction_groups=[g for g in groups if len(g) > 1],
    )


def crossover_pairing(directions: list[Point]) -> tuple[tuple[int, int], tuple[int, int]] | None:
    """
    Pair four wire directions into two straight-through runs.

    Args:
        directions: Four unit vectors pointing from the crossing outward along each wire.
    Returns:
        The two index pairs of the straightest pairing, or None when either pair bends more than
        CROSSOVER_MIN_STRAIGHTNESS allows (then the cluster is not a clean crossover).
    """
    best: tuple[float, tuple[tuple[int, int], tuple[int, int]]] | None = None
    for first in ((0, 1), (0, 2), (0, 3)):
        second = tuple(i for i in range(4) if i not in first)
        cos_a = directions[first[0]][0] * directions[first[1]][0] + directions[first[0]][1] * directions[first[1]][1]
        cos_b = directions[second[0]][0] * directions[second[1]][0] + directions[second[0]][1] * directions[second[1]][1]
        worst = max(cos_a, cos_b)
        if best is None or worst < best[0]:
            best = (worst, (first, (second[0], second[1])))
    if best is None or best[0] > -CROSSOVER_MIN_STRAIGHTNESS:
        return None
    return best[1]


def resolve_connectivity(graph: SkeletonGraph, spurs: set[int], reach: float) -> tuple[UnionFind, int, int]:
    """
    Union skeleton edges into nets with the junction / crossover rules.

    Args:
        graph: Skeleton graph.
        spurs: Edge ids to ignore when counting a cluster's wires (short dangling artefacts).
        reach: Distance over which wire directions at a cluster are measured.
    Returns:
        (union-find over edge ids 0..n_edges, number of crossovers split, number of forced junction merges).
    """
    uf = UnionFind(graph.n_edges + 1)
    crossovers = 0
    junction_merges = 0
    for c, edges in graph.incidence.items():
        wires = [e for e in edges if e not in spurs]
        if c not in graph.cluster_forced and len(wires) == 4 and len(set(wires)) == 4:
            centre = graph.cluster_centroids[c]
            dirs = [_direction(graph.edge_pixels[e], centre, reach) for e in wires]
            pairing = crossover_pairing(dirs)
            if pairing is not None:
                for i, j in pairing:
                    uf.union(wires[i], wires[j])
                crossovers += 1
                continue
        if c in graph.cluster_forced and len(set(wires)) > 1:
            junction_merges += 1
        for a, b in combinations(sorted(set(edges)), 2):
            uf.union(a, b)
    for group in graph.junction_groups:
        edges = sorted({e for c in group for e in graph.incidence.get(c, [])})
        for e in edges[1:]:
            uf.union(edges[0], e)
    return uf, crossovers, junction_merges


def edge_length(graph: SkeletonGraph, edge: int) -> int:
    """
    Pixel count of an edge.

    Args:
        graph: Skeleton graph.
        edge: Edge id.
    Returns:
        Number of skeleton pixels in the edge.
    """
    pixels = graph.edge_pixels.get(edge)
    return 0 if pixels is None else int(len(pixels))
