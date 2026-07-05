/**
 * @file mna.ts
 * @description Analog-lite DC solver — modified nodal analysis over one analog
 * island. Electrical nets are built with union-find over component terminals
 * (edges are electrically undirected), stamped into a dense conductance
 * matrix (resistors, switches, potentiometers, voltage sources), and solved
 * with Gaussian elimination + partial pivoting. LEDs use a piecewise-linear
 * Vf model chosen by a short Newton-style iteration (segment selection until
 * stable). Explicit non-goals: AC/transient analysis, firmware emulation.
 */

import type { AnalogOutputs, DigiEdge, DigiNode } from '../../types';

/** LED piecewise model: off below VF, then a resistive segment. */
const LED_VF = 1.9;
const LED_R_ON = 8;
/** LED display calibration: full brightness at this forward current. */
const LED_FULL_A = 0.012;
/** Above this forward current the LED is flagged as overdriven. */
const LED_MAX_A = 0.025;
/** Closed-switch series resistance. */
const SWITCH_R_ON = 0.01;
/** Leak from every net to reference so floating sub-nets stay solvable. */
const G_MIN = 1e-9;
/** Segment-selection iterations for the LED piecewise model. */
const MAX_NEWTON_ITERATIONS = 8;

/** Default part parameters when the node carries none. */
export const DEFAULT_VSOURCE_V = 5;
export const DEFAULT_RESISTOR_OHMS = 220;
export const DEFAULT_POT_OHMS = 10000;

/** Terminal names per analog node type (index 0 = 'a' side, 1 = 'b' side). */
const TERMINALS: Record<string, [string, string] | [string]> = {
  vsource: ['pos', 'neg'],
  resistor: ['a', 'b'],
  led: ['anode', 'cathode'],
  analogSwitch: ['a', 'b'],
  potentiometer: ['a', 'b'],
  ground: ['gnd'],
};

/**
 * Terminal names for one analog node type.
 *
 * @param type - Analog node type string
 * @returns Terminal name list (single-entry for ground)
 */
export function terminalsOf(type: string | undefined): readonly string[] {
  return TERMINALS[type ?? ''] ?? ['a', 'b'];
}

/**
 * Map a ReactFlow handle id to its electrical terminal name.
 * Handles use the dual `t:<terminal>` / `s:<terminal>` scheme so wires can be
 * drawn in either direction; a missing handle means the node's first terminal.
 *
 * @param handle - Edge sourceHandle/targetHandle value
 * @param type - The node's type (for its default terminal)
 * @returns Terminal name, e.g. 'anode'
 */
function handleTerminal(handle: string | null | undefined, type: string | undefined): string {
  if (!handle) return terminalsOf(type)[0];
  return handle.startsWith('t:') || handle.startsWith('s:') ? handle.slice(2) : handle;
}

/**
 * Solve one fully-analog island for DC node voltages and branch currents.
 *
 * @param nodes - The island's analog nodes
 * @param edges - The island's edges (wires between terminals)
 * @returns Per-node solver outputs keyed by node id
 */
export function solveAnalogIsland(
  nodes: DigiNode[],
  edges: DigiEdge[]
): Map<string, AnalogOutputs> {
  const outputs = new Map<string, AnalogOutputs>(
    nodes.map((n) => [n.id, { current: 0, voltageDrop: 0 }])
  );
  const typeOf = new Map(nodes.map((n) => [n.id, n.type ?? '']));

  // --- Electrical nets: union-find over "<nodeId>/<terminal>" keys ----------
  const parent = new Map<string, string>();
  for (const node of nodes) {
    for (const terminal of terminalsOf(node.type)) {
      const key = `${node.id}/${terminal}`;
      parent.set(key, key);
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
  for (const edge of edges) {
    const from = `${edge.source}/${handleTerminal(edge.sourceHandle, typeOf.get(edge.source))}`;
    const to = `${edge.target}/${handleTerminal(edge.targetHandle, typeOf.get(edge.target))}`;
    if (parent.has(from) && parent.has(to)) parent.set(find(from), find(to));
  }

  // Net index per terminal key; reference net (index -1) is ground when
  // present, else the first source's negative terminal, else the first net.
  const netOf = new Map<string, number>();
  const roots: string[] = [];
  const rootIndex = new Map<string, number>();
  Array.from(parent.keys()).forEach((key) => {
    const root = find(key);
    if (!rootIndex.has(root)) {
      rootIndex.set(root, roots.length);
      roots.push(root);
    }
    netOf.set(key, rootIndex.get(root)!);
  });
  const groundNode = nodes.find((n) => n.type === 'ground');
  const firstSource = nodes.find((n) => n.type === 'vsource');
  const referenceKey = groundNode
    ? `${groundNode.id}/gnd`
    : firstSource
      ? `${firstSource.id}/neg`
      : roots[0];
  const referenceNet = referenceKey !== undefined ? netOf.get(referenceKey)! : 0;

  const sources = nodes.filter((n) => n.type === 'vsource');
  const netCount = roots.length;
  const unknowns = netCount - 1 + sources.length;
  if (unknowns <= 0 || sources.length === 0) return outputs; // nothing drives it

  /** Matrix row/column of a net (-1 = reference, folded away). */
  const netVar = (net: number): number => (net < referenceNet ? net : net - 1);
  const varOfKey = (key: string): number => {
    const net = netOf.get(key)!;
    return net === referenceNet ? -1 : netVar(net);
  };

  // --- Newton-style segment selection for LEDs ------------------------------
  const leds = nodes.filter((n) => n.type === 'led');
  let ledOn = new Map<string, boolean>(leds.map((l) => [l.id, true]));
  let voltages: number[] = [];

  for (let iteration = 0; iteration < MAX_NEWTON_ITERATIONS; iteration++) {
    const size = unknowns;
    const matrix: number[][] = Array.from({ length: size }, () => Array(size).fill(0));
    const rhs: number[] = Array(size).fill(0);

    /** Stamp a conductance between two terminal keys. */
    const stampG = (keyA: string, keyB: string, g: number): void => {
      const a = varOfKey(keyA);
      const b = varOfKey(keyB);
      if (a >= 0) matrix[a][a] += g;
      if (b >= 0) matrix[b][b] += g;
      if (a >= 0 && b >= 0) {
        matrix[a][b] -= g;
        matrix[b][a] -= g;
      }
    };
    /** Add an independent current (amps) flowing INTO a terminal's net. */
    const stampI = (key: string, amps: number): void => {
      const index = varOfKey(key);
      if (index >= 0) rhs[index] += amps;
    };

    for (const node of nodes) {
      const type = node.type ?? '';
      if (type === 'resistor') {
        const ohms = Math.max(0.001, node.data.param ?? DEFAULT_RESISTOR_OHMS);
        stampG(`${node.id}/a`, `${node.id}/b`, 1 / ohms);
      } else if (type === 'potentiometer') {
        const max = Math.max(1, node.data.param ?? DEFAULT_POT_OHMS);
        const ohms = Math.max(0.5, (max * (node.data.percent ?? 50)) / 100);
        stampG(`${node.id}/a`, `${node.id}/b`, 1 / ohms);
      } else if (type === 'analogSwitch') {
        if (node.data.closed) {
          stampG(`${node.id}/a`, `${node.id}/b`, 1 / SWITCH_R_ON);
        }
      } else if (type === 'led') {
        if (ledOn.get(node.id)) {
          // On segment: I = (V - VF) / R_ON → conductance + RHS shift.
          const g = 1 / LED_R_ON;
          stampG(`${node.id}/anode`, `${node.id}/cathode`, g);
          stampI(`${node.id}/anode`, g * LED_VF);
          stampI(`${node.id}/cathode`, -g * LED_VF);
        } else {
          stampG(`${node.id}/anode`, `${node.id}/cathode`, G_MIN);
        }
      }
    }
    // Voltage sources: extra current unknown per source, V(pos) - V(neg) = V.
    sources.forEach((source, sourceIndex) => {
      const row = netCount - 1 + sourceIndex;
      const pos = varOfKey(`${source.id}/pos`);
      const neg = varOfKey(`${source.id}/neg`);
      if (pos >= 0) {
        matrix[pos][row] += 1;
        matrix[row][pos] += 1;
      }
      if (neg >= 0) {
        matrix[neg][row] -= 1;
        matrix[row][neg] -= 1;
      }
      rhs[row] = source.data.param ?? DEFAULT_VSOURCE_V;
    });
    // Tiny leak to reference keeps floating nets from making the matrix singular.
    for (let net = 0; net < netCount; net++) {
      if (net !== referenceNet) matrix[netVar(net)][netVar(net)] += G_MIN;
    }

    voltages = gaussianSolve(matrix, rhs);

    // Re-pick LED segments; stop as soon as every choice is consistent.
    const nextOn = new Map<string, boolean>();
    let changed = false;
    for (const led of leds) {
      const drop = voltageAt(led.id, 'anode') - voltageAt(led.id, 'cathode');
      const on = drop > LED_VF;
      nextOn.set(led.id, on);
      if (on !== ledOn.get(led.id)) changed = true;
    }
    ledOn = nextOn;
    if (!changed) break;
  }

  /**
   * Solved voltage of a terminal's net (0 for the reference net).
   * @param nodeId - Component node id
   * @param terminal - Terminal name
   * @returns Volts relative to the reference net
   */
  function voltageAt(nodeId: string, terminal: string): number {
    const index = varOfKey(`${nodeId}/${terminal}`);
    return index >= 0 && index < voltages.length ? voltages[index] : 0;
  }

  // --- Per-component outputs -------------------------------------------------
  nodes.forEach((node) => {
    const type = node.type ?? '';
    const out = outputs.get(node.id)!;
    if (type === 'resistor' || type === 'potentiometer' || type === 'analogSwitch') {
      const [ta, tb] = terminalsOf(type);
      const drop = voltageAt(node.id, ta) - voltageAt(node.id, tb!);
      let ohms = Math.max(0.001, node.data.param ?? DEFAULT_RESISTOR_OHMS);
      if (type === 'potentiometer') {
        const max = Math.max(1, node.data.param ?? DEFAULT_POT_OHMS);
        ohms = Math.max(0.5, (max * (node.data.percent ?? 50)) / 100);
      }
      if (type === 'analogSwitch') {
        out.current = node.data.closed ? Math.abs(drop) / SWITCH_R_ON : 0;
        out.voltageDrop = drop;
        return;
      }
      out.current = Math.abs(drop) / ohms;
      out.voltageDrop = drop;
    } else if (type === 'led') {
      const drop = voltageAt(node.id, 'anode') - voltageAt(node.id, 'cathode');
      const current = ledOn.get(node.id) ? Math.max(0, (drop - LED_VF) / LED_R_ON) : 0;
      out.current = current;
      out.voltageDrop = drop;
      out.brightness = Math.min(1, current / LED_FULL_A);
      if (current > LED_MAX_A) {
        out.simWarning = `LED overcurrent (${Math.round(current * 1000)}mA) — add a series resistor`;
      }
    } else if (type === 'vsource') {
      const sourceIndex = sources.findIndex((s) => s.id === node.id);
      const branch = netCount - 1 + sourceIndex;
      out.current = Math.abs(voltages[branch] ?? 0);
      out.voltageDrop = node.data.param ?? DEFAULT_VSOURCE_V;
    }
  });
  return outputs;
}

/**
 * Solve Ax = b by Gaussian elimination with partial pivoting.
 * Near-singular pivots zero their variable instead of exploding (floating nets).
 *
 * @param matrix - Dense square matrix (mutated)
 * @param rhs - Right-hand side (mutated)
 * @returns Solution vector
 */
export function gaussianSolve(matrix: number[][], rhs: number[]): number[] {
  const size = rhs.length;
  for (let col = 0; col < size; col++) {
    // Partial pivot: bring the largest remaining |entry| to the diagonal.
    let pivotRow = col;
    for (let row = col + 1; row < size; row++) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivotRow][col])) pivotRow = row;
    }
    if (pivotRow !== col) {
      [matrix[col], matrix[pivotRow]] = [matrix[pivotRow], matrix[col]];
      [rhs[col], rhs[pivotRow]] = [rhs[pivotRow], rhs[col]];
    }
    const pivot = matrix[col][col];
    if (Math.abs(pivot) < 1e-12) continue; // floating variable → stays 0
    for (let row = col + 1; row < size; row++) {
      const factor = matrix[row][col] / pivot;
      if (factor === 0) continue;
      for (let k = col; k < size; k++) matrix[row][k] -= factor * matrix[col][k];
      rhs[row] -= factor * rhs[col];
    }
  }
  const solution = Array(size).fill(0);
  for (let row = size - 1; row >= 0; row--) {
    const pivot = matrix[row][row];
    if (Math.abs(pivot) < 1e-12) continue;
    let sum = rhs[row];
    for (let col = row + 1; col < size; col++) sum -= matrix[row][col] * solution[col];
    solution[row] = sum / pivot;
  }
  return solution;
}
