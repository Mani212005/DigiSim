/**
 * @file mnaSpice.test.ts
 * @description Unit tests for non-linear SPICE MNA solver (mnaSpice.ts) and SPICE / Spectre netlister (netlistSpice.ts).
 */

import type { DigiEdge, DigiNode, NodeData } from '../../types';
import { generateSpiceNetlist, generateSpectreNetlist } from './netlistSpice';
import { solveSpiceMNA } from './mnaSpice';

const node = (id: string, type: string, data: Partial<NodeData> = {}): DigiNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { label: id, value: 0, ...data },
});

const wire = (
  source: string,
  sourceTerminal: string,
  target: string,
  targetTerminal: string
): DigiEdge => ({
  id: `${source}:${sourceTerminal}-${target}:${targetTerminal}`,
  source,
  target,
  sourceHandle: `s:${sourceTerminal}`,
  targetHandle: `t:${targetTerminal}`,
});

describe('netlistSpice', () => {
  test('generates valid SPICE .cir netlist string with models and component lines', () => {
    const nodes = [
      node('V1', 'vsource', { param: 5 }),
      node('R1', 'resistor', { param: 1000 }),
      node('G1', 'ground'),
    ];
    const edges = [
      wire('V1', 'pos', 'R1', 'a'),
      wire('R1', 'b', 'V1', 'neg'),
      wire('G1', 'gnd', 'V1', 'neg'),
    ];

    const netlist = generateSpiceNetlist(nodes, edges, { title: 'Test Circuit' });
    expect(netlist).toContain('* Test Circuit');
    expect(netlist).toContain('.model NMOS180');
    expect(netlist).toContain('R1');
    expect(netlist).toContain('V1');
    expect(netlist).toContain('.op');
    expect(netlist).toContain('.end');
  });

  test('generates Cadence Spectre native netlist syntax', () => {
    const nodes = [
      node('V1', 'vsource', { param: 3.3 }),
      node('M1', 'nmos', { width: 1.8, length: 0.18 }),
      node('G1', 'ground'),
    ];
    const edges = [
      wire('V1', 'pos', 'M1', 'g'),
      wire('M1', 's', 'V1', 'neg'),
      wire('G1', 'gnd', 'V1', 'neg'),
    ];

    const spectre = generateSpectreNetlist(nodes, edges, { title: 'Spectre Test' });
    expect(spectre).toContain('// Spectre Test');
    expect(spectre).toContain('simulator lang=spectre');
    expect(spectre).toContain('model nmos180 nmos');
    expect(spectre).toContain('vsource dc=3.3');
  });
});

describe('mnaSpice non-linear solver', () => {
  test('solves non-linear MOSFET circuit operating region and currents', () => {
    const nodes = [
      node('Vdd', 'vsource', { param: 1.8 }),
      node('Vin', 'vsource', { param: 1.8 }),
      node('M1', 'nmos', { width: 1.8, length: 0.18 }),
      node('G1', 'ground'),
    ];
    const edges = [
      wire('Vdd', 'pos', 'M1', 'd'),
      wire('Vin', 'pos', 'M1', 'g'),
      wire('M1', 's', 'Vdd', 'neg'),
      wire('Vin', 'neg', 'Vdd', 'neg'),
      wire('G1', 'gnd', 'Vdd', 'neg'),
    ];

    const outputs = solveSpiceMNA(nodes, edges);
    const m1Out = outputs.get('M1');
    expect(m1Out).toBeDefined();
    expect(m1Out!.region).toBe('Saturation');
    expect(m1Out!.vgs).toBeCloseTo(1.8, 2);
    expect(m1Out!.vds).toBeCloseTo(1.8, 2);
    expect(m1Out!.id).toBeGreaterThan(0.0001);
  });
});
