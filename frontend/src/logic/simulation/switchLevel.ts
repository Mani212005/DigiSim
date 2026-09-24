/**
 * @file switchLevel.ts
 * @description Switch-level CMOS logic solver for transistor-first DigiSim.
 * Treats NMOS (ON when gate=1) and PMOS (ON when gate=0) as ideal switches
 * between their drain/source terminals, with vsource/ground/inputs as drivers.
 * Lets hand-wired CMOS (e.g. a NAND from 2 PMOS + 2 NMOS) simulate to the
 * correct digital truth table without a full analog SPICE solve. Bulk
 * terminals are ignored (autoBulk ties them); mixed transistor+primitive-gate
 * wiring on one canvas is out of scope and resolves to X/Z.
 */

import type { DigiEdge, DigiNode } from '../../types';

/** Digital net value used by the switch solver. */
export type SwitchValue = 0 | 1 | 'X' | 'Z';

/** Node types that participate in switch-level nets. */
const SWITCH_NODE_TYPES: ReadonlySet<string> = new Set([
  'input',
  'output',
  'vsource',
  'ground',
  'clockSource',
  'nmos',
  'pmos',
  'customComponent',
]);

/**
 * Normalize a ReactFlow handle into a canonical terminal name.
 * Accepts legacy aliases seen in sample circuits (gate/source/drain).
 * @param handle - Raw handle id (e.g. "t:gate", "s:d", "a")
 * @returns Canonical terminal (e.g. "g", "s", "d", "pos", "gnd")
 */
export function normalizeTerminal(handle: string | null | undefined): string {
  if (!handle) return '';
  const raw = handle.startsWith('t:') || handle.startsWith('s:')
    ? handle.slice(2)
    : handle;
  const t = raw.trim().toLowerCase();
  if (t === 'gate' || t === 'g') return 'g';
  if (t === 'source' || t === 's' || t === 'src') return 's';
  if (t === 'drain' || t === 'd' || t === 'dst') return 'd';
  if (t === 'bulk' || t === 'body' || t === 'b' || t === 'bulkbody') return 'b';
  if (t === 'pos' || t === 'p' || t === 'vdd' || t === 'vcc' || t === '+') return 'pos';
  if (t === 'neg' || t === 'n' || t === 'vss' || t === 'vee' || t === '-') return 'neg';
  if (t === 'gnd' || t === 'ground' || t === '0') return 'gnd';
  if (t === 'clk' || t === 'clock' || t === 'c') return 'clk';
  if (t === 'anode' || t === 'a' || t === 'in1' || t === 'in') return t;
  return t;
}

/**
 * Terminal key for a node+handle in the switch network.
 * Single-net nodes (input/output) collapse to their node id.
 * @param node - Canvas node
 * @param handle - Edge handle on that node
 * @returns Net key, or null when the node cannot join switch nets
 */
function terminalKeyFor(
  node: DigiNode,
  handle: string | null | undefined
): string | null {
  const type = node.type ?? '';
  if (!SWITCH_NODE_TYPES.has(type)) return null;
  if (type === 'input' || type === 'output') return `${node.id}`;
  const term = normalizeTerminal(handle);
  if (type === 'vsource') {
    if (term === 'pos' || term === 'neg' || term === '') {
      return `${node.id}/${term === '' ? 'pos' : term}`;
    }
    return `${node.id}/pos`;
  }
  if (type === 'ground') return `${node.id}/gnd`;
  if (type === 'clockSource') {
    if (term === 'clk' || term === 'gnd') return `${node.id}/${term}`;
    return `${node.id}/clk`;
  }
  if (type === 'nmos' || type === 'pmos') {
    if (term === 'd' || term === 'g' || term === 's') return `${node.id}/${term}`;
    // Bulk is intentionally ignored (autoBulk); unknown handles float.
    return null;
  }
  // customComponent: one net per pin id carried by the handle.
  if (type === 'customComponent') {
    if (term === '') return null;
    return `${node.id}/${term}`;
  }
  return null;
}

/**
 * Numeric logic value of a node driver, if it is a clean 0/1.
 * @param value - Node data value
 * @returns 0, 1, or null when not a clean binary driver
 */
function asBinary(value: unknown): 0 | 1 | null {
  if (value === 1 || value === '1') return 1;
  if (value === 0 || value === '0') return 0;
  return null;
}

/**
 * Solve switch-level nets for transistor-first circuits.
 * @param nodes - Canvas (or subcircuit-internal) nodes
 * @param edges - Canvas (or subcircuit-internal) edges
 * @param nodeById - Current node states (drivers: inputs, supplies, customs)
 * @returns Map from every registered terminal key (`id`, `id/d`, `id/pos`…)
 *   to its resolved 0/1/X/Z, so callers look up keys directly
 */
export function solveSwitchNets(
  nodes: DigiNode[],
  edges: DigiEdge[],
  nodeById: Map<string, DigiNode>
): Map<string, SwitchValue> {
  const parent = new Map<string, string>();
  const ensure = (key: string): void => {
    if (!parent.has(key)) parent.set(key, key);
  };

  // Register every switch terminal key.
  for (const node of nodes) {
    const type = node.type ?? '';
    if (!SWITCH_NODE_TYPES.has(type)) continue;
    if (type === 'input' || type === 'output') {
      ensure(`${node.id}`);
    } else if (type === 'vsource') {
      ensure(`${node.id}/pos`);
      ensure(`${node.id}/neg`);
    } else if (type === 'ground') {
      ensure(`${node.id}/gnd`);
    } else if (type === 'clockSource') {
      ensure(`${node.id}/clk`);
      ensure(`${node.id}/gnd`);
    } else if (type === 'nmos' || type === 'pmos') {
      ensure(`${node.id}/d`);
      ensure(`${node.id}/g`);
      ensure(`${node.id}/s`);
    } else if (type === 'customComponent') {
      // Pin nets are created lazily from edges below.
    }
  }

  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = key;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (a: string | null, b: string | null): void => {
    if (!a || !b) return;
    if (!parent.has(a) || !parent.has(b)) return;
    parent.set(find(a), find(b));
  };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const keyForEdgeEnd = (node: DigiNode, handle: string | null | undefined): string | null => {
    const type = node.type ?? '';
    if (type === 'input' || type === 'output') return `${node.id}`;
    return terminalKeyFor(node, handle);
  };
  for (const edge of edges) {
    const src = byId.get(edge.source);
    const tgt = byId.get(edge.target);
    if (!src || !tgt) continue;
    if (!SWITCH_NODE_TYPES.has(src.type ?? '') || !SWITCH_NODE_TYPES.has(tgt.type ?? '')) {
      continue;
    }
    // Lazily register custom pin nets mentioned by this edge.
    if (src.type === 'customComponent') {
      const term = normalizeTerminal(edge.sourceHandle);
      if (term !== '') ensure(`${src.id}/${term}`);
    }
    if (tgt.type === 'customComponent') {
      const term = normalizeTerminal(edge.targetHandle);
      if (term !== '') ensure(`${tgt.id}/${term}`);
    }
    union(keyForEdgeEnd(src, edge.sourceHandle), keyForEdgeEnd(tgt, edge.targetHandle));
  }

  // All grounds and supply returns share the 0V reference net.
  const groundKeys = Array.from(parent.keys()).filter(
    (k) => k.endsWith('/gnd') || k.endsWith('/neg')
  );
  for (let i = 1; i < groundKeys.length; i++) union(groundKeys[0], groundKeys[i]);

  const values = new Map<string, SwitchValue>();
  Array.from(parent.keys()).forEach((key) => values.set(find(key), 'Z'));

  const setDriver = (key: string | null, v: SwitchValue): void => {
    if (!key || !parent.has(key)) return;
    const root = find(key);
    const cur = values.get(root) ?? 'Z';
    if (cur === 'Z') {
      values.set(root, v);
    } else if (cur !== v) {
      // Conflicting strong drivers contend to X (except Z merging).
      if (v !== 'Z') values.set(root, 'X');
    }
  };

  // Strong drivers: supplies, grounds, inputs, clocks, custom outputs.
  for (const node of nodes) {
    const type = node.type ?? '';
    const live = nodeById.get(node.id) ?? node;
    if (type === 'vsource') {
      setDriver(`${node.id}/pos`, 1);
      setDriver(`${node.id}/neg`, 0);
    } else if (type === 'ground') {
      setDriver(`${node.id}/gnd`, 0);
    } else if (type === 'clockSource') {
      const b = asBinary(live.data.value);
      setDriver(`${node.id}/clk`, b === null ? 'X' : b);
      setDriver(`${node.id}/gnd`, 0);
    } else if (type === 'input') {
      const b = asBinary(live.data.value);
      setDriver(`${node.id}`, b === null ? (live.data.value === 'Z' ? 'Z' : 'X') : b);
    } else if (type === 'customComponent') {
      const v = live.data.value as Record<string, number | string> | undefined;
      if (v && typeof v === 'object') {
        for (const [pinId, pinVal] of Object.entries(v)) {
          const b = asBinary(pinVal);
          if (b !== null) setDriver(`${node.id}/${pinId}`, b);
          else if (pinVal === 'X') setDriver(`${node.id}/${pinId}`, 'X');
        }
      }
    }
  }

  interface Switch {
    isNmos: boolean;
    dRoot: string;
    gRoot: string;
    sRoot: string;
  }
  const switches: Switch[] = [];
  for (const node of nodes) {
    if (node.type !== 'nmos' && node.type !== 'pmos') continue;
    if (!parent.has(`${node.id}/d`) || !parent.has(`${node.id}/g`) || !parent.has(`${node.id}/s`)) {
      continue;
    }
    switches.push({
      isNmos: node.type === 'nmos',
      dRoot: find(`${node.id}/d`),
      gRoot: find(`${node.id}/g`),
      sRoot: find(`${node.id}/s`),
    });
  }

  // Propagate through ON switches until stable (series/parallel handled).
  for (let iter = 0; iter < 30; iter++) {
    let changed = false;
    for (const sw of switches) {
      const g = values.get(sw.gRoot) ?? 'Z';
      const on = sw.isNmos ? g === 1 : g === 0;
      const off = sw.isNmos ? g === 0 : g === 1;
      if (!on && !off) {
        // Unknown gate: if either side is driven and the other floats,
        // the float stays Z (no propagation through an uncertain switch).
        continue;
      }
      if (off) continue;
      const d = values.get(sw.dRoot) ?? 'Z';
      const s = values.get(sw.sRoot) ?? 'Z';
      if (d !== 'Z' && s === 'Z') {
        values.set(sw.sRoot, d);
        changed = true;
      } else if (s !== 'Z' && d === 'Z') {
        values.set(sw.dRoot, s);
        changed = true;
      } else if (d !== 'Z' && s !== 'Z' && d !== s) {
        // Both sides driven differently through an ON switch: contention.
        if (values.get(sw.dRoot) !== 'X') {
          values.set(sw.dRoot, 'X');
          changed = true;
        }
        if (values.get(sw.sRoot) !== 'X') {
          values.set(sw.sRoot, 'X');
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // Expand to per-key lookups so callers read `${id}` or `${id}/d` directly.
  const perKey = new Map<string, SwitchValue>();
  Array.from(parent.keys()).forEach((key) => perKey.set(key, values.get(find(key)) ?? 'Z'));
  return perKey;
}

/**
 * Resolve one terminal/net key to its solved value.
 * @param solved - Map returned by solveSwitchNets (keyed per terminal key)
 * @param key - Terminal key (`id`, `id/d`, `id/pos`…)
 * @returns Solved value or Z when unknown
 */
export function switchRootValue(
  solved: Map<string, SwitchValue>,
  key: string
): SwitchValue {
  return solved.get(key) ?? 'Z';
}
