/**
 * @file islands.ts
 * @description Partitions the canvas into electrically independent islands
 * (connected components of the node/edge graph) and classifies each as
 * digital (gates, I/O) or analog (resistors, sources, LEDs…). The simulate()
 * entry point routes each island to the matching solver: fully-analog islands
 * go to the MNA solver, everything else keeps today's digital semantics.
 */

import type { DigiEdge, DigiNode } from '../../types';

/** Node types solved by the analog MNA engine. */
export const ANALOG_TYPES: ReadonlySet<string> = new Set([
  'vsource',
  'ground',
  'resistor',
  'led',
  'analogSwitch',
  'potentiometer',
]);

/** One electrically independent sub-circuit of the canvas. */
export interface SimulationIsland {
  nodes: DigiNode[];
  edges: DigiEdge[];
  /** 'analog' when every node is an analog type; 'digital' otherwise. */
  kind: 'digital' | 'analog';
  /** True when the island mixes analog parts with gates/IO (S3 territory). */
  mixed: boolean;
}

/**
 * Split the canvas into connected components and classify each one.
 *
 * @param nodes - All canvas nodes
 * @param edges - All canvas edges
 * @returns Islands with their solver classification
 */
export function partitionIslands(
  nodes: DigiNode[],
  edges: DigiEdge[]
): SimulationIsland[] {
  // Union-find over node ids.
  const parent = new Map<string, string>(nodes.map((n) => [n.id, n.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = id;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  for (const edge of edges) {
    if (parent.has(edge.source) && parent.has(edge.target)) {
      parent.set(find(edge.source), find(edge.target));
    }
  }

  const groups = new Map<string, { nodes: DigiNode[]; edges: DigiEdge[] }>();
  for (const node of nodes) {
    const root = find(node.id);
    if (!groups.has(root)) groups.set(root, { nodes: [], edges: [] });
    groups.get(root)!.nodes.push(node);
  }
  for (const edge of edges) {
    if (parent.has(edge.source)) {
      groups.get(find(edge.source))?.edges.push(edge);
    }
  }

  return Array.from(groups.values()).map((group) => {
    const analogCount = group.nodes.filter((n) => ANALOG_TYPES.has(n.type ?? '')).length;
    return {
      ...group,
      kind: analogCount === group.nodes.length ? ('analog' as const) : ('digital' as const),
      mixed: analogCount > 0 && analogCount < group.nodes.length,
    };
  });
}
