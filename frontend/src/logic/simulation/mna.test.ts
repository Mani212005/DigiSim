/**
 * @file mna.test.ts
 * @description Unit tests for the analog MNA DC solver — voltage divider vs
 * the analytic result, LED series current and brightness, switch open/closed,
 * LED-without-resistor overcurrent, potentiometer scaling, island routing
 * (mixed islands flag analog parts instead of solving them).
 */

import type { DigiEdge, DigiNode, NodeData } from '../../types';
import { simulate } from './index';
import { solveAnalogIsland } from './mna';

/**
 * Build a test node.
 * @param id - Node id (also used as the label)
 * @param type - ReactFlow node type
 * @param data - Extra data fields (param, closed, …)
 * @returns Canvas node fixture
 */
const node = (id: string, type: string, data: Partial<NodeData> = {}): DigiNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { label: id, value: 0, ...data },
});

/**
 * Build a wire between two terminals.
 * @param source - Source node id
 * @param sourceTerminal - Source terminal name (e.g. 'pos')
 * @param target - Target node id
 * @param targetTerminal - Target terminal name (e.g. 'a')
 * @returns Edge fixture using the dual-handle id scheme
 */
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

describe('solveAnalogIsland', () => {
  test('voltage divider matches the analytic result', () => {
    const nodes = [
      node('V1', 'vsource', { param: 5 }),
      node('R1', 'resistor', { param: 1000 }),
      node('R2', 'resistor', { param: 1000 }),
      node('G1', 'ground'),
    ];
    const edges = [
      wire('V1', 'pos', 'R1', 'a'),
      wire('R1', 'b', 'R2', 'a'),
      wire('R2', 'b', 'V1', 'neg'),
      wire('G1', 'gnd', 'V1', 'neg'),
    ];
    const out = solveAnalogIsland(nodes, edges);
    // Equal resistors split 5V in half: 2.5V and 2.5mA each.
    expect(out.get('R1')!.voltageDrop).toBeCloseTo(2.5, 3);
    expect(out.get('R2')!.voltageDrop).toBeCloseTo(2.5, 3);
    expect(out.get('R1')!.current).toBeCloseTo(0.0025, 5);
    expect(out.get('V1')!.current).toBeCloseTo(0.0025, 5);
  });

  test('unequal divider follows the ratio', () => {
    const nodes = [
      node('V1', 'vsource', { param: 9 }),
      node('R1', 'resistor', { param: 6000 }),
      node('R2', 'resistor', { param: 3000 }),
      node('G1', 'ground'),
    ];
    const edges = [
      wire('V1', 'pos', 'R1', 'a'),
      wire('R1', 'b', 'R2', 'a'),
      wire('R2', 'b', 'V1', 'neg'),
      wire('G1', 'gnd', 'V1', 'neg'),
    ];
    const out = solveAnalogIsland(nodes, edges);
    expect(out.get('R1')!.voltageDrop).toBeCloseTo(6, 3);
    expect(out.get('R2')!.voltageDrop).toBeCloseTo(3, 3);
  });

  test('series LED conducts the expected current and lights up', () => {
    const nodes = [
      node('V1', 'vsource', { param: 5 }),
      node('R1', 'resistor', { param: 220 }),
      node('D1', 'led'),
      node('G1', 'ground'),
    ];
    const edges = [
      wire('V1', 'pos', 'R1', 'a'),
      wire('R1', 'b', 'D1', 'anode'),
      wire('D1', 'cathode', 'V1', 'neg'),
      wire('G1', 'gnd', 'V1', 'neg'),
    ];
    const out = solveAnalogIsland(nodes, edges);
    // I = (5 − 1.9) / (220 + 8) ≈ 13.6 mA — bright, but not overdriven.
    expect(out.get('D1')!.current).toBeCloseTo(0.0136, 3);
    expect(out.get('D1')!.brightness).toBe(1);
    expect(out.get('D1')!.simWarning).toBeUndefined();
  });

  test('a big resistor dims the LED', () => {
    const nodes = [
      node('V1', 'vsource', { param: 5 }),
      node('R1', 'resistor', { param: 1000 }),
      node('D1', 'led'),
      node('G1', 'ground'),
    ];
    const edges = [
      wire('V1', 'pos', 'R1', 'a'),
      wire('R1', 'b', 'D1', 'anode'),
      wire('D1', 'cathode', 'V1', 'neg'),
      wire('G1', 'gnd', 'V1', 'neg'),
    ];
    const out = solveAnalogIsland(nodes, edges);
    const brightness = out.get('D1')!.brightness!;
    expect(brightness).toBeGreaterThan(0.15);
    expect(brightness).toBeLessThan(0.5);
  });

  test('reverse-wired LED stays dark', () => {
    const nodes = [
      node('V1', 'vsource', { param: 5 }),
      node('R1', 'resistor', { param: 220 }),
      node('D1', 'led'),
      node('G1', 'ground'),
    ];
    const edges = [
      wire('V1', 'pos', 'R1', 'a'),
      wire('R1', 'b', 'D1', 'cathode'), // backwards
      wire('D1', 'anode', 'V1', 'neg'),
      wire('G1', 'gnd', 'V1', 'neg'),
    ];
    const out = solveAnalogIsland(nodes, edges);
    expect(out.get('D1')!.current).toBeCloseTo(0, 5);
    expect(out.get('D1')!.brightness).toBe(0);
  });

  test('LED without a series resistor is flagged as overcurrent', () => {
    const nodes = [
      node('V1', 'vsource', { param: 5 }),
      node('D1', 'led'),
      node('G1', 'ground'),
    ];
    const edges = [
      wire('V1', 'pos', 'D1', 'anode'),
      wire('D1', 'cathode', 'V1', 'neg'),
      wire('G1', 'gnd', 'V1', 'neg'),
    ];
    const out = solveAnalogIsland(nodes, edges);
    expect(out.get('D1')!.current).toBeGreaterThan(0.025);
    expect(out.get('D1')!.simWarning).toMatch(/overcurrent/i);
  });

  test('open switch blocks current; closed switch conducts', () => {
    const build = (closed: boolean): Map<string, { current: number }> => {
      const nodes = [
        node('V1', 'vsource', { param: 5 }),
        node('S1', 'analogSwitch', { closed }),
        node('R1', 'resistor', { param: 500 }),
        node('G1', 'ground'),
      ];
      const edges = [
        wire('V1', 'pos', 'S1', 'a'),
        wire('S1', 'b', 'R1', 'a'),
        wire('R1', 'b', 'V1', 'neg'),
        wire('G1', 'gnd', 'V1', 'neg'),
      ];
      return solveAnalogIsland(nodes, edges);
    };
    expect(build(false).get('R1')!.current).toBeCloseTo(0, 5);
    expect(build(true).get('R1')!.current).toBeCloseTo(0.01, 4);
  });

  test('potentiometer at 50% of 10k acts as 5k', () => {
    const nodes = [
      node('V1', 'vsource', { param: 10 }),
      node('P1', 'potentiometer', { param: 10000, percent: 50 }),
      node('G1', 'ground'),
    ];
    const edges = [
      wire('V1', 'pos', 'P1', 'a'),
      wire('P1', 'b', 'V1', 'neg'),
      wire('G1', 'gnd', 'V1', 'neg'),
    ];
    const out = solveAnalogIsland(nodes, edges);
    expect(out.get('P1')!.current).toBeCloseTo(0.002, 5); // 10V / 5kΩ
  });

  test('island without a source solves to all zeros', () => {
    const nodes = [node('R1', 'resistor', { param: 100 }), node('G1', 'ground')];
    const edges = [wire('R1', 'b', 'G1', 'gnd')];
    const out = solveAnalogIsland(nodes, edges);
    expect(out.get('R1')!.current).toBe(0);
    expect(out.get('R1')!.voltageDrop).toBe(0);
  });
});

describe('board pin stubs (S3)', () => {
  /** Minimal dev board: 3V3 rail, one GPIO, one GND pin. */
  const board = (pinConfig: NodeData['pinConfig'], logicVoltage?: number): DigiNode =>
    node('U1', 'hardware', {
      pins: [
        { name: '3V3', role: 'power', side: 'left' },
        { name: 'GPIO4', role: 'digital', side: 'right' },
        { name: 'GND', role: 'ground', side: 'left' },
      ],
      pinConfig,
      logicVoltage,
    });

  /** GPIO4 → 220Ω → LED → GND loop around the board. */
  const ledLoop = (): DigiEdge[] => [
    wire('U1', 'GPIO4', 'R1', 'a'),
    wire('R1', 'b', 'D1', 'anode'),
    wire('D1', 'cathode', 'U1', 'GND'),
  ];

  test('GPIO driven HIGH lights an LED through a resistor', () => {
    const nodes = [
      board({ GPIO4: { mode: 'high' } }),
      node('R1', 'resistor', { param: 220 }),
      node('D1', 'led'),
    ];
    const out = solveAnalogIsland(nodes, ledLoop());
    // I = (3.3 − 1.9) / (40 + 220 + 8) ≈ 5.2 mA.
    expect(out.get('D1')!.current).toBeCloseTo(0.0052, 3);
    expect(out.get('D1')!.brightness!).toBeGreaterThan(0.3);
    expect(out.get('U1')!.current).toBeCloseTo(0.0052, 3);
  });

  test('5V logic level raises the current', () => {
    const nodes = [
      board({ GPIO4: { mode: 'high' } }, 5),
      node('R1', 'resistor', { param: 220 }),
      node('D1', 'led'),
    ];
    const out = solveAnalogIsland(nodes, ledLoop());
    // I = (5 − 1.9) / 268 ≈ 11.6 mA.
    expect(out.get('D1')!.current).toBeCloseTo(0.0116, 3);
  });

  test('GPIO LOW and Hi-Z keep the LED dark', () => {
    for (const pinConfig of [{ GPIO4: { mode: 'low' as const } }, undefined]) {
      const nodes = [
        board(pinConfig),
        node('R1', 'resistor', { param: 220 }),
        node('D1', 'led'),
      ];
      const out = solveAnalogIsland(nodes, ledLoop());
      expect(out.get('D1')!.current).toBeCloseTo(0, 4);
    }
  });

  test('power rail pin drives like a supply', () => {
    const nodes = [
      board(undefined),
      node('R1', 'resistor', { param: 330 }),
    ];
    const edges = [
      wire('U1', '3V3', 'R1', 'a'),
      wire('R1', 'b', 'U1', 'GND'),
    ];
    const out = solveAnalogIsland(nodes, edges);
    expect(out.get('R1')!.current).toBeCloseTo(3.3 / 331, 4);
  });

  test('blink pin follows the sim clock', () => {
    const nodes = [
      board({ GPIO4: { mode: 'blink', hz: 1 } }),
      node('R1', 'resistor', { param: 220 }),
      node('D1', 'led'),
    ];
    // 1 Hz: ON during [0, 0.5)s, OFF during [0.5, 1)s.
    const lit = solveAnalogIsland(nodes, ledLoop(), 0.1);
    const dark = solveAnalogIsland(nodes, ledLoop(), 0.6);
    expect(lit.get('D1')!.current).toBeGreaterThan(0.004);
    expect(dark.get('D1')!.current).toBeCloseTo(0, 4);
  });

  test('PWM duty scales LED brightness by time-averaging', () => {
    const run = (duty: number): number => {
      const nodes = [
        board({ GPIO4: { mode: 'pwm', duty } }),
        node('R1', 'resistor', { param: 220 }),
        node('D1', 'led'),
      ];
      return solveAnalogIsland(nodes, ledLoop()).get('D1')!.brightness!;
    };
    const full = run(100);
    expect(run(50)).toBeCloseTo(full / 2, 3);
    expect(run(25)).toBeCloseTo(full / 4, 3);
  });
});

describe('simulate() island routing', () => {
  test('analog island is solved while a digital island keeps gate semantics', () => {
    const nodes = [
      // Digital island: input(1) → NOT → output.
      node('I1', 'input', { value: 1 }),
      node('N1', 'notGate'),
      node('O1', 'output'),
      // Analog island: source + resistor loop.
      node('V1', 'vsource', { param: 5 }),
      node('R1', 'resistor', { param: 1000 }),
      node('G1', 'ground'),
    ];
    const edges: DigiEdge[] = [
      { id: 'e1', source: 'I1', target: 'N1' },
      { id: 'e2', source: 'N1', target: 'O1' },
      wire('V1', 'pos', 'R1', 'a'),
      wire('R1', 'b', 'V1', 'neg'),
      wire('G1', 'gnd', 'V1', 'neg'),
    ];
    const result = simulate(nodes, edges);
    const byId = new Map(result.map((n) => [n.id, n]));
    expect(byId.get('O1')!.data.value).toBe(0); // NOT(1)
    expect(byId.get('R1')!.data.current).toBeCloseTo(0.005, 4); // 5V / 1kΩ
  });

  test('mixing gates with analog parts flags the analog nodes instead of solving', () => {
    const nodes = [
      node('I1', 'input', { value: 1 }),
      node('R1', 'resistor', { param: 100 }),
    ];
    const edges: DigiEdge[] = [{ id: 'e1', source: 'I1', target: 'R1' }];
    const result = simulate(nodes, edges);
    const resistor = result.find((n) => n.id === 'R1')!;
    expect(resistor.data.simWarning).toMatch(/S3/);
    expect(resistor.data.current).toBe(0);
  });
});
