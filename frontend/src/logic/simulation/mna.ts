/**
 * @file mna.ts
 * @description Analog-lite DC solver — modified nodal analysis over one analog
 * island. Electrical nets are built with union-find over component terminals
 * (edges are electrically undirected), stamped into a dense conductance
 * matrix (resistors, switches, potentiometers, voltage sources), and solved
 * with Gaussian elimination + partial pivoting. LEDs use a piecewise-linear
 * Vf model chosen by a short Newton-style iteration (segment selection until
 * stable). Hardware boards participate via pin stubs (S3): GND pins join the
 * reference net, power pins and configured GPIO pins stamp as Norton sources,
 * blink pins follow the sim clock, and PWM pins are solved twice (on/off)
 * with outputs combined by duty — exact time-averaging for square waves.
 * Explicit non-goals: AC/transient analysis, firmware emulation.
 */

import type { AnalogOutputs, DigiEdge, DigiNode, LibraryPin, PinConfig, TechNode } from '../../types';
import { PDKManager } from '../pdk/PDKManager';
import { CellRegistry } from '../hierarchy/CellRegistry';

/** LED piecewise model: off below VF, then a resistive segment. */
const LED_VF = 1.9;
const LED_R_ON = 8;
/** LED display calibration: full brightness at this forward current. */
const LED_FULL_A = 0.012;
/** Above this forward current the LED is flagged as overdriven. */
const LED_MAX_A = 0.025;
/** Closed-switch series resistance. */
const SWITCH_R_ON = 0.01;
/** GPIO output impedance (Norton source resistance for driven pins). */
const GPIO_R = 40;
/** Board power-rail internal resistance. */
const RAIL_R = 1;
/** Leak from every net to reference so floating sub-nets stay solvable. */
const G_MIN = 1e-9;
/** Segment-selection iterations for the LED piecewise model. */
const MAX_NEWTON_ITERATIONS = 8;

/** Default part parameters when the node carries none. */
export const DEFAULT_VSOURCE_V = 5;
export const DEFAULT_RESISTOR_OHMS = 220;
export const DEFAULT_POT_OHMS = 10000;
export const DEFAULT_LOGIC_V = 3.3;

/** Terminal names per analog node type (index 0 = 'a' side, 1 = 'b' side). */
const TERMINALS: Record<string, string[]> = {
  vsource: ['pos', 'neg'],
  resistor: ['a', 'b'],
  led: ['anode', 'cathode'],
  analogSwitch: ['a', 'b'],
  potentiometer: ['a', 'b'],
  ground: ['gnd'],
  nmos: ['d', 'g', 's', 'b'],
  pmos: ['s', 'g', 'd', 'b'],
};

/**
 * Terminal names for one node — static per analog type, the pin map for
 * hardware boards.
 *
 * @param node - Analog part or hardware board node
 * @returns Terminal name list
 */
export function terminalsOfNode(node: DigiNode): readonly string[] {
  if (node.type === 'hardware') {
    return (node.data.pins ?? []).map((pin) => pin.name);
  }
  if (node.type === 'subckt') {
    const cellDef = CellRegistry.getCell(node.data.cellName || 'INVERTER');
    if (cellDef) return cellDef.ports.map((p) => p.name);
    return ['in', 'out', 'vdd', 'vss'];
  }
  return TERMINALS[node.type ?? ''] ?? ['a', 'b'];
}

/** How one board pin behaves electrically. */
interface PinDrive {
  volts: number;
  ohms: number;
  /** True for PWM pins — they alternate between volts and 0V by duty. */
  pwm: boolean;
  duty: number;
}

/**
 * Is this board pin a ground pin (joins the reference net)?
 * @param pin - Library pin entry
 * @returns True for ground-role or GND-named pins
 */
function isGroundPin(pin: LibraryPin): boolean {
  return pin.role === 'ground' || /^(gnd|ground)/i.test(pin.name);
}

/**
 * Electrical drive of one board pin, or null when it is high-impedance.
 *
 * @param pin - Library pin entry from the board's pin map
 * @param config - The pin's user configuration (may be undefined)
 * @param logicVoltage - Board GPIO HIGH voltage (3.3 or 5)
 * @param timeSeconds - Sim clock for blink phase
 * @returns Norton-source parameters or null (Hi-Z / input)
 */
function pinDrive(
  pin: LibraryPin,
  config: PinConfig | undefined,
  logicVoltage: number,
  timeSeconds: number
): PinDrive | null {
  if (pin.role === 'power') {
    const name = pin.name.toLowerCase();
    const volts = name.includes('3') ? 3.3 : 5; // 3V3 rails vs 5V/VIN
    return { volts, ohms: RAIL_R, pwm: false, duty: 100 };
  }
  if (!config || config.mode === 'hiz') return null;
  if (config.mode === 'high') {
    return { volts: logicVoltage, ohms: GPIO_R, pwm: false, duty: 100 };
  }
  if (config.mode === 'low') {
    return { volts: 0, ohms: GPIO_R, pwm: false, duty: 100 };
  }
  if (config.mode === 'blink') {
    const hz = config.hz ?? 1;
    const on = Math.floor(timeSeconds * hz * 2) % 2 === 0;
    return { volts: on ? logicVoltage : 0, ohms: GPIO_R, pwm: false, duty: 100 };
  }
  // PWM: alternates logicVoltage/0 — solved twice and combined by duty.
  return { volts: logicVoltage, ohms: GPIO_R, pwm: true, duty: config.duty ?? 50 };
}

/**
 * Solve one analog island (analog parts + hardware boards) for DC node
 * voltages and branch currents.
 *
 * @param nodes - The island's nodes
 * @param edges - The island's edges (wires between terminals)
 * @param timeSeconds - Sim clock (drives blink pins); defaults to 0
 * @returns Per-node solver outputs keyed by node id
 */
export function solveAnalogIsland(
  nodes: DigiNode[],
  edges: DigiEdge[],
  timeSeconds = 0
): Map<string, AnalogOutputs> {
  const outputs = new Map<string, AnalogOutputs>(
    nodes.map((n) => [n.id, { current: 0, voltageDrop: 0 }])
  );
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // --- Electrical nets: union-find over "<nodeId>/<terminal>" keys ----------
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
  const handleTerminal = (
    handle: string | null | undefined,
    nodeId: string
  ): string => {
    if (handle && (handle.startsWith('t:') || handle.startsWith('s:'))) {
      return handle.slice(2);
    }
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

  // Ground is one global net: ground symbols + every board GND pin.
  const groundKeys: string[] = [];
  for (const node of nodes) {
    if (node.type === 'ground') groundKeys.push(`${node.id}/gnd`);
    if (node.type === 'hardware') {
      for (const pin of node.data.pins ?? []) {
        if (isGroundPin(pin)) groundKeys.push(`${node.id}/${pin.name}`);
      }
    }
  }
  for (let i = 1; i < groundKeys.length; i++) union(groundKeys[0], groundKeys[i]);

  // Board pin drives (power rails + configured GPIO), evaluated at sim time.
  const drives: { nodeId: string; terminal: string; drive: PinDrive }[] = [];
  for (const node of nodes) {
    if (node.type !== 'hardware') continue;
    const logicVoltage = node.data.logicVoltage ?? DEFAULT_LOGIC_V;
    for (const pin of node.data.pins ?? []) {
      if (isGroundPin(pin)) continue;
      const drive = pinDrive(pin, node.data.pinConfig?.[pin.name], logicVoltage, timeSeconds);
      if (drive) drives.push({ nodeId: node.id, terminal: pin.name, drive });
    }
  }

  // Net index per terminal key.
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

  const sources = nodes.filter((n) => n.type === 'vsource');
  const firstSource = sources[0];
  const referenceKey =
    groundKeys[0] ?? (firstSource ? `${firstSource.id}/neg` : roots[0]);
  const referenceNet = referenceKey !== undefined ? netOf.get(referenceKey)! : 0;

  const netCount = roots.length;
  const unknowns = netCount - 1 + sources.length;
  if (unknowns <= 0 || (sources.length === 0 && drives.length === 0)) {
    return outputs; // nothing drives this island
  }

  /** Matrix row/column of a net (-1 = reference, folded away). */
  const netVar = (net: number): number => (net < referenceNet ? net : net - 1);
  const varOfKey = (key: string): number => {
    const net = netOf.get(key)!;
    return net === referenceNet ? -1 : netVar(net);
  };

  const leds = nodes.filter((n) => n.type === 'led');

  /**
   * One full DC solve with PWM pins forced on or off.
   * @param pwmOn - Whether PWM pins drive their HIGH level (vs 0V)
   * @returns Per-node outputs for this PWM phase
   */
  const solveOnce = (pwmOn: boolean): Map<string, AnalogOutputs> => {
    let ledOn = new Map<string, boolean>(leds.map((l) => [l.id, true]));
    let voltages: number[] = [];

    /**
     * Solved voltage of a terminal's net (0 for the reference net).
     * @param nodeId - Component node id
     * @param terminal - Terminal name
     * @returns Volts relative to the reference net
     */
    const voltageAt = (nodeId: string, terminal: string): number => {
      const index = varOfKey(`${nodeId}/${terminal}`);
      return index >= 0 && index < voltages.length ? voltages[index] : 0;
    };

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
        } else if (type === 'nmos' || type === 'pmos') {
          const isNmos = type === 'nmos';
          const techNode: TechNode = node.data.techNode ?? '180nm';
          const model = PDKManager.getModelCard(techNode, isNmos ? 'nmos' : 'pmos');
          const width = node.data.width ?? (isNmos ? 1.2 : 2.4);
          const length = node.data.length ?? 0.18;
          const nf = node.data.nf ?? 1;

          const vd = voltageAt(node.id, 'd');
          const vg = voltageAt(node.id, 'g');
          const vs = voltageAt(node.id, 's');
          let vb = voltageAt(node.id, 'b');

          if (node.data.autoBulk !== false && vb === 0) {
            vb = isNmos ? 0 : model.Vdd;
          }

          const op = PDKManager.calculateOperatingRegion(
            isNmos ? 'nmos' : 'pmos',
            model,
            width,
            length,
            nf,
            vd,
            vg,
            vs,
            vb
          );

          stampG(`${node.id}/g`, `${node.id}/s`, G_MIN);

          if (op.region === 'Cutoff') {
            stampG(`${node.id}/d`, `${node.id}/s`, G_MIN);
          } else {
            const vdsEff = Math.max(0.01, Math.abs(vd - vs));
            const g_ds = Math.max(1e-4, op.ids / vdsEff);
            stampG(`${node.id}/d`, `${node.id}/s`, g_ds);
          }
        }
      }
      // Board pins: Norton source (volts behind ohms) from pin net to reference.
      for (const { nodeId, terminal, drive } of drives) {
        const volts = drive.pwm && !pwmOn ? 0 : drive.volts;
        const g = 1 / drive.ohms;
        const index = varOfKey(`${nodeId}/${terminal}`);
        if (index >= 0) {
          matrix[index][index] += g;
          rhs[index] += volts * g;
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
      // Tiny leak to reference keeps floating nets from making it singular.
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

    // --- Per-component outputs for this phase -------------------------------
    const phase = new Map<string, AnalogOutputs>(
      nodes.map((n) => [n.id, { current: 0, voltageDrop: 0 }])
    );
    nodes.forEach((node) => {
      const type = node.type ?? '';
      const out = phase.get(node.id)!;
      if (type === 'resistor' || type === 'potentiometer' || type === 'analogSwitch') {
        const drop = voltageAt(node.id, 'a') - voltageAt(node.id, 'b');
        if (type === 'analogSwitch') {
          out.current = node.data.closed ? Math.abs(drop) / SWITCH_R_ON : 0;
          out.voltageDrop = drop;
          return;
        }
        let ohms = Math.max(0.001, node.data.param ?? DEFAULT_RESISTOR_OHMS);
        if (type === 'potentiometer') {
          const max = Math.max(1, node.data.param ?? DEFAULT_POT_OHMS);
          ohms = Math.max(0.5, (max * (node.data.percent ?? 50)) / 100);
        }
        out.current = Math.abs(drop) / ohms;
        out.voltageDrop = drop;
      } else if (type === 'led') {
        const drop = voltageAt(node.id, 'anode') - voltageAt(node.id, 'cathode');
        const current = ledOn.get(node.id) ? Math.max(0, (drop - LED_VF) / LED_R_ON) : 0;
        out.current = current;
        out.voltageDrop = drop;
        out.brightness = Math.min(1, current / LED_FULL_A);
      } else if (type === 'nmos' || type === 'pmos') {
        const isNmos = type === 'nmos';
        const techNode: TechNode = node.data.techNode ?? '180nm';
        const model = PDKManager.getModelCard(techNode, isNmos ? 'nmos' : 'pmos');
        const width = node.data.width ?? (isNmos ? 1.2 : 2.4);
        const length = node.data.length ?? 0.18;
        const nf = node.data.nf ?? 1;

        const vd = voltageAt(node.id, 'd');
        const vg = voltageAt(node.id, 'g');
        const vs = voltageAt(node.id, 's');
        let vb = voltageAt(node.id, 'b');

        if (node.data.autoBulk !== false && vb === 0) {
          vb = isNmos ? 0 : model.Vdd;
        }

        const op = PDKManager.calculateOperatingRegion(
          isNmos ? 'nmos' : 'pmos',
          model,
          width,
          length,
          nf,
          vd,
          vg,
          vs,
          vb
        );

        out.current = op.ids;
        out.voltageDrop = Math.abs(vd - vs);
        out.region = op.region;
        out.vth = op.vth;
        out.cdf = op.cdf;
      } else if (type === 'vsource') {
        const sourceIndex = sources.findIndex((s) => s.id === node.id);
        out.current = Math.abs(voltages[netCount - 1 + sourceIndex] ?? 0);
        out.voltageDrop = node.data.param ?? DEFAULT_VSOURCE_V;
      } else if (type === 'hardware') {
        // Board supply current: sum of what its driven pins push/sink.
        let total = 0;
        for (const { nodeId, terminal, drive } of drives) {
          if (nodeId !== node.id) continue;
          const volts = drive.pwm && !pwmOn ? 0 : drive.volts;
          total += Math.abs(volts - voltageAt(nodeId, terminal)) / drive.ohms;
        }
        out.current = total;
      }
    });
    return phase;
  };

  // PWM pins → two phases combined by duty (square-wave time average);
  // otherwise one solve is exact.
  const pwmDrives = drives.filter((d) => d.drive.pwm);
  const onPhase = solveOnce(true);
  const duty = pwmDrives.length > 0 ? (pwmDrives[0].drive.duty ?? 50) / 100 : 1;
  const offPhase = pwmDrives.length > 0 && duty < 1 ? solveOnce(false) : null;

  nodes.forEach((node) => {
    const out = outputs.get(node.id)!;
    const on = onPhase.get(node.id)!;
    const off = offPhase?.get(node.id);
    const mix = (a: number, b: number): number => duty * a + (1 - duty) * b;
    out.current = off ? mix(on.current, off.current) : on.current;
    out.voltageDrop = off ? mix(on.voltageDrop, off.voltageDrop) : on.voltageDrop;
    if (on.brightness !== undefined) {
      out.brightness = off ? mix(on.brightness, off.brightness ?? 0) : on.brightness;
    }
    if (on.region) out.region = on.region;
    if (on.vth !== undefined) out.vth = on.vth;
    if (on.cdf) out.cdf = on.cdf;
    if (node.type === 'led' && out.current > LED_MAX_A) {
      out.simWarning = `LED overcurrent (${Math.round(out.current * 1000)}mA) — add a series resistor`;
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
