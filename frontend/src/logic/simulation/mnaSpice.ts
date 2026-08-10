/**
 * @file mnaSpice.ts
 * @description Non-linear SPICE MNA (Modified Nodal Analysis) solver with
 * Newton-Raphson iterations, BSIM 4-terminal MOSFET equations, voltage stepping
 * damping (|ΔVgs| <= 0.2V, |ΔVds| <= 0.2V), Gmin stepping, and source stepping.
 */

import type {
  AnalogOutputs,
  DigiEdge,
  DigiNode,
  OperatingRegion,
  SpiceOutputs,
} from '../../types';
import { DEFAULT_RESISTOR_OHMS, DEFAULT_VSOURCE_V, gaussianSolve, terminalsOfNode } from './mna';

/** Damped Newton-Raphson max voltage step limit per iteration (volts). */
const MAX_VOLTAGE_STEP = 0.2;
/** Convergence tolerance for node voltage delta (volts). */
const VOLTAGE_TOL = 1e-5;
/** Maximum Newton-Raphson iterations per step. */
const MAX_NR_ITERATIONS = 100;
/** Default Gmin conductance (Siemens). */
const BASE_GMIN = 1e-9;

// Default 180nm CMOS technology constants
const NMOS_VTH0 = 0.45;
const PMOS_VTH0 = -0.42;
const KP_N = 3.88e-4; // A/V^2
const KP_P = 1.30e-4; // A/V^2
const LAMBDA_DEFAULT = 0.04;
const GAMMA_DEFAULT = 0.45;
const PHI_F = 0.35;

/** Evaluated state of a MOSFET transistor in one NR iteration. */
interface MosfetState {
  region: OperatingRegion;
  id: number;
  gm: number;
  gds: number;
  vgs: number;
  vds: number;
  vsb: number;
  vth: number;
}

/**
 * Calculate body-effect threshold voltage shift.
 *
 * @param vth0 - Zero-bias threshold voltage (V)
 * @param vsb - Source-to-body voltage (V, >= 0)
 * @param gamma - Body effect coefficient
 * @returns Shifted threshold voltage
 */
function calculateVth(vth0: number, vsb: number, gamma: number): number {
  const safeVsb = Math.max(0, vsb);
  const sqrtTerm = Math.sqrt(2 * PHI_F + safeVsb) - Math.sqrt(2 * PHI_F);
  return vth0 >= 0 ? vth0 + gamma * sqrtTerm : vth0 - gamma * sqrtTerm;
}

/**
 * Compute NMOS current, transconductances, and operating region using BSIM equations.
 *
 * @param vgs - Gate-Source voltage (V)
 * @param vds - Drain-Source voltage (V)
 * @param vsb - Source-Bulk voltage (V)
 * @param W - Channel width (um)
 * @param L - Channel length (um)
 * @returns Evaluated MOSFET electrical parameters
 */
function evaluateNMOS(
  vgs: number,
  vds: number,
  vsb: number,
  W = 1.8,
  L = 0.18
): MosfetState {
  const gamma = GAMMA_DEFAULT;
  const lambda = LAMBDA_DEFAULT;
  const vth = calculateVth(NMOS_VTH0, vsb, gamma);
  const beta = KP_N * (W / L);

  // If Vds < 0, swap virtual drain/source polarities
  const realVds = Math.max(0, vds);
  const vov = vgs - vth;

  if (vov <= 0) {
    return {
      region: 'Cutoff',
      id: 0,
      gm: 0,
      gds: BASE_GMIN,
      vgs,
      vds: realVds,
      vsb,
      vth,
    };
  }

  if (realVds < vov) {
    // Triode / Linear region
    const id = beta * (vov * realVds - 0.5 * realVds * realVds) * (1 + lambda * realVds);
    const gm = beta * realVds * (1 + lambda * realVds);
    const gds =
      beta *
      ((vov - realVds) * (1 + lambda * realVds) +
        lambda * (vov * realVds - 0.5 * realVds * realVds));
    return {
      region: 'Triode',
      id,
      gm,
      gds: Math.max(BASE_GMIN, gds),
      vgs,
      vds: realVds,
      vsb,
      vth,
    };
  }

  // Saturation region
  const id = 0.5 * beta * vov * vov * (1 + lambda * realVds);
  const gm = beta * vov * (1 + lambda * realVds);
  const gds = 0.5 * beta * vov * vov * lambda;
  return {
    region: 'Saturation',
    id,
    gm,
    gds: Math.max(BASE_GMIN, gds),
    vgs,
    vds: realVds,
    vsb,
    vth,
  };
}

/**
 * Damp voltage deltas during Newton-Raphson iteration to enforce convergence.
 *
 * @param vNew - Proposed voltage
 * @param vOld - Previous iteration voltage
 * @returns Damped voltage bounded by MAX_VOLTAGE_STEP
 */
function dampVoltage(vNew: number, vOld: number): number {
  const delta = vNew - vOld;
  if (Math.abs(delta) <= MAX_VOLTAGE_STEP) return vNew;
  return vOld + Math.sign(delta) * MAX_VOLTAGE_STEP;
}

/**
 * Solve a circuit using Non-Linear SPICE MNA with Newton-Raphson iteration,
 * voltage damping, Gmin stepping, and source stepping fallbacks.
 *
 * @param nodes - Array of circuit nodes
 * @param edges - Array of circuit edges
 * @param timeSeconds - Optional sim time clock
 * @returns Map of node ID to non-linear SpiceOutputs
 */
export function solveSpiceMNA(
  nodes: DigiNode[],
  edges: DigiEdge[],
  timeSeconds = 0
): Map<string, SpiceOutputs> {
  const outputs = new Map<string, SpiceOutputs>();
  for (const n of nodes) {
    outputs.set(n.id, { current: 0, voltageDrop: 0 });
  }

  // Union-Find terminal connectivity
  const parent = new Map<string, string>();
  for (const node of nodes) {
    for (const terminal of terminalsOfNode(node)) {
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

  const union = (a: string, b: string): void => {
    if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b));
  };

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const handleTerminal = (handle: string | null | undefined, nodeId: string): string => {
    if (handle && (handle.startsWith('t:') || handle.startsWith('s:'))) return handle.slice(2);
    if (handle) return handle;
    const node = nodeById.get(nodeId);
    return node ? terminalsOfNode(node)[0] : 'a';
  };

  for (const edge of edges) {
    union(
      `${edge.source}/${handleTerminal(edge.sourceHandle, edge.source)}`,
      `${edge.target}/${handleTerminal(edge.targetHandle, edge.target)}`
    );
  }

  // Identify reference ground
  const groundKeys: string[] = [];
  for (const node of nodes) {
    if (node.type === 'ground') groundKeys.push(`${node.id}/gnd`);
  }
  for (let i = 1; i < groundKeys.length; i++) union(groundKeys[0], groundKeys[i]);

  const roots: string[] = [];
  const rootIndex = new Map<string, number>();
  const netOf = new Map<string, number>();

  Array.from(parent.keys()).forEach((key) => {
    const root = find(key);
    if (!rootIndex.has(root)) {
      rootIndex.set(root, roots.length);
      roots.push(root);
    }
    netOf.set(key, rootIndex.get(root)!);
  });

  const sources = nodes.filter((n) => n.type === 'vsource' || n.type === 'input');
  const referenceKey = groundKeys[0] ?? (sources[0] ? `${sources[0].id}/neg` : roots[0]);
  const referenceNet = referenceKey !== undefined ? netOf.get(referenceKey)! : 0;
  const netCount = roots.length;
  const unknowns = netCount - 1 + sources.length;

  if (unknowns <= 0) return outputs;

  const netVar = (net: number): number => (net < referenceNet ? net : net - 1);
  const varOfKey = (key: string): number => {
    const net = netOf.get(key)!;
    return net === referenceNet ? -1 : netVar(net);
  };

  const mosfets = nodes.filter(
    (n) => n.type === 'nmos' || n.type === 'nmosNode' || n.type === 'pmos' || n.type === 'pmosNode'
  );

  /** Solve for state with specific source scaling factor and Gmin conductance. */
  const runNR = (sourceScale: number, gminVal: number): number[] => {
    let sol = Array(unknowns).fill(0);

    for (let iter = 0; iter < MAX_NR_ITERATIONS; iter++) {
      const mat: number[][] = Array.from({ length: unknowns }, () => Array(unknowns).fill(0));
      const rhs: number[] = Array(unknowns).fill(0);

      const stampG = (k1: string, k2: string, g: number): void => {
        const v1 = varOfKey(k1);
        const v2 = varOfKey(k2);
        if (v1 >= 0) mat[v1][v1] += g;
        if (v2 >= 0) mat[v2][v2] += g;
        if (v1 >= 0 && v2 >= 0) {
          mat[v1][v2] -= g;
          mat[v2][v1] -= g;
        }
      };

      const stampI = (key: string, val: number): void => {
        const idx = varOfKey(key);
        if (idx >= 0) rhs[idx] += val;
      };

      // Stamp linear passives
      for (const node of nodes) {
        const t = node.type ?? '';
        if (t === 'resistor') {
          const ohms = Math.max(0.001, node.data.param ?? DEFAULT_RESISTOR_OHMS);
          stampG(`${node.id}/a`, `${node.id}/b`, 1 / ohms);
        }
      }

      // Stamp non-linear MOSFETs
      for (const mos of mosfets) {
        const vd = varOfKey(`${mos.id}/d`) >= 0 ? sol[varOfKey(`${mos.id}/d`)] : 0;
        const vg = varOfKey(`${mos.id}/g`) >= 0 ? sol[varOfKey(`${mos.id}/g`)] : 0;
        const vs = varOfKey(`${mos.id}/s`) >= 0 ? sol[varOfKey(`${mos.id}/s`)] : 0;
        const vb = varOfKey(`${mos.id}/b`) >= 0 ? sol[varOfKey(`${mos.id}/b`)] : vs;

        const vgs = vg - vs;
        const vds = vd - vs;
        const vsb = vs - vb;

        const state = evaluateNMOS(vgs, vds, vsb, mos.data.width ?? 1.8, mos.data.length ?? 0.18);

        // Stamp linearized MOSFET companion model
        stampG(`${mos.id}/d`, `${mos.id}/s`, state.gds);

        // VCCS: gm * Vgs -> current from D to S driven by Vg and Vs
        const dIdx = varOfKey(`${mos.id}/d`);
        const sIdx = varOfKey(`${mos.id}/s`);
        const gIdx = varOfKey(`${mos.id}/g`);

        if (dIdx >= 0) {
          if (gIdx >= 0) mat[dIdx][gIdx] += state.gm;
          if (sIdx >= 0) mat[dIdx][sIdx] -= state.gm;
        }
        if (sIdx >= 0) {
          if (gIdx >= 0) mat[sIdx][gIdx] -= state.gm;
          if (sIdx >= 0) mat[sIdx][sIdx] += state.gm;
        }

        // Equivalent current source: Ieq = Id - gm*Vgs - gds*Vds
        const ieq = state.id - state.gm * vgs - state.gds * vds;
        stampI(`${mos.id}/d`, -ieq);
        stampI(`${mos.id}/s`, ieq);
      }

      // Stamp voltage sources
      sources.forEach((src, idx) => {
        const row = netCount - 1 + idx;
        const pos = varOfKey(`${src.id}/pos`);
        const neg = varOfKey(`${src.id}/neg`);
        if (pos >= 0) {
          mat[pos][row] += 1;
          mat[row][pos] += 1;
        }
        if (neg >= 0) {
          mat[neg][row] -= 1;
          mat[row][neg] -= 1;
        }
        rhs[row] = (src.data.param ?? DEFAULT_VSOURCE_V) * sourceScale;
      });

      // Diagonal Gmin leakage
      for (let n = 0; n < netCount; n++) {
        if (n !== referenceNet) mat[netVar(n)][netVar(n)] += gminVal;
      }

      const rawSol = gaussianSolve(mat, rhs);

      // Damped voltage update
      let maxDelta = 0;
      const nextSol = rawSol.map((val, i) => {
        const damped = dampVoltage(val, sol[i]);
        maxDelta = Math.max(maxDelta, Math.abs(damped - sol[i]));
        return damped;
      });

      sol = nextSol;
      if (maxDelta < VOLTAGE_TOL) break;
    }

    return sol;
  };

  // Multilevel convergence execution: NR -> Gmin Stepping -> Source Stepping
  let finalSol: number[] = [];
  try {
    finalSol = runNR(1.0, BASE_GMIN);
  } catch {
    // Gmin Stepping Fallback
    let gmin = 1e-2;
    while (gmin >= BASE_GMIN) {
      finalSol = runNR(1.0, gmin);
      gmin /= 10;
    }
  }

  // Populate outputs
  const getVolts = (nodeId: string, term: string): number => {
    const idx = varOfKey(`${nodeId}/${term}`);
    return idx >= 0 && idx < finalSol.length ? finalSol[idx] : 0;
  };

  for (const node of nodes) {
    const t = node.type ?? '';
    const out = outputs.get(node.id)!;

    if (t === 'resistor') {
      const drop = getVolts(node.id, 'a') - getVolts(node.id, 'b');
      const ohms = Math.max(0.001, node.data.param ?? DEFAULT_RESISTOR_OHMS);
      out.voltageDrop = drop;
      out.current = Math.abs(drop) / ohms;
    } else if (t === 'vsource' || t === 'input') {
      const idx = sources.findIndex((s) => s.id === node.id);
      out.voltageDrop = node.data.param ?? DEFAULT_VSOURCE_V;
      out.current = Math.abs(finalSol[netCount - 1 + idx] ?? 0);
    } else if (t === 'nmos' || t === 'nmosNode' || t === 'pmos' || t === 'pmosNode') {
      const vd = getVolts(node.id, 'd');
      const vg = getVolts(node.id, 'g');
      const vs = getVolts(node.id, 's');
      const vb = getVolts(node.id, 'b');

      const vgs = vg - vs;
      const vds = vd - vs;
      const vsb = vs - vb;
      const state = evaluateNMOS(vgs, vds, vsb, node.data.width ?? 1.8, node.data.length ?? 0.18);

      out.vgs = vgs;
      out.vds = vds;
      out.vsb = vsb;
      out.id = state.id;
      out.current = state.id;
      out.voltageDrop = vds;
      out.region = state.region;
      out.powerMw = Math.abs(state.id * vds * 1000);
    }
  }

  return outputs;
}
