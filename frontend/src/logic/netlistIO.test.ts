/**
 * @file netlistIO.test.ts
 * @description Tests for canonical JSON netlist export/import — round-trip fidelity,
 * every validation error class, auto-layout, and optional explicit positions.
 */

import { exportNetlist, parseNetlist } from './netlistIO';
import type { DigiEdge, DigiNode, NetlistExportJSON } from '../types';

/** Build a node with sensible defaults for tests. */
const node = (id: string, type: string, label: string): DigiNode => ({
  id,
  type,
  data: { label, value: 0 },
  position: { x: Number(id) * 100, y: 0 },
});

/** Build an edge with an optional target handle. */
const edge = (id: string, source: string, target: string, handle?: string): DigiEdge => ({
  id,
  source,
  target,
  targetHandle: handle ?? null,
});

/** The default canvas: Input A, Input B → AND → Output. */
const andCircuit = (): { nodes: DigiNode[]; edges: DigiEdge[] } => ({
  nodes: [
    node('1', 'input', 'Input A'),
    node('2', 'input', 'Input B'),
    node('3', 'andGate', 'AND Gate'),
    node('4', 'output', 'Output'),
  ],
  edges: [
    edge('e1', '1', '3', 'a'),
    edge('e2', '2', '3', 'b'),
    edge('e3', '3', '4'),
  ],
});

/** The spec's two-gate example: (A AND B) → N1; (N1 OR C) → OUT. */
const specNetlist = (): NetlistExportJSON => ({
  circuit_name: 'Spec Example',
  components: [
    { id: 'U1', type: 'AND_GATE', inputs: ['A', 'B'], output: 'N1' },
    { id: 'U2', type: 'OR_GATE', inputs: ['N1', 'C'], output: 'OUT' },
  ],
  nets: ['A', 'B', 'C', 'N1', 'OUT'],
  io: { inputs: ['A', 'B', 'C'], outputs: ['OUT'] },
});

describe('exportNetlist', () => {
  test('serializes the default AND circuit into the canonical schema', () => {
    const { nodes, edges } = andCircuit();
    const doc = exportNetlist(nodes, edges, 'My Circuit');
    expect(doc).toEqual({
      circuit_name: 'My Circuit',
      components: [{ id: 'U1', type: 'AND_GATE', inputs: ['A', 'B'], output: 'OUT1' }],
      nets: ['A', 'B', 'OUT1'],
      io: { inputs: ['A', 'B'], outputs: ['OUT1'] },
    });
  });

  test('names internal nets N1… and preserves custom output labels', () => {
    const nodes = [
      node('1', 'input', 'A'),
      node('2', 'notGate', 'NOT Gate'),
      node('3', 'orGate', 'OR Gate'),
      node('4', 'output', 'SUM'),
    ];
    const edges = [
      edge('e1', '1', '2', 'a'),
      edge('e2', '2', '3', 'a'),
      edge('e3', '1', '3', 'b'),
      edge('e4', '3', '4'),
    ];
    const doc = exportNetlist(nodes, edges, 'x');
    expect(doc.components).toEqual([
      { id: 'U1', type: 'NOT_GATE', inputs: ['A'], output: 'N1' },
      { id: 'U2', type: 'OR_GATE', inputs: ['N1', 'A'], output: 'SUM' },
    ]);
    expect(doc.io).toEqual({ inputs: ['A'], outputs: ['SUM'] });
  });

  test('de-duplicates colliding input labels', () => {
    const nodes = [
      node('1', 'input', 'A'),
      node('2', 'input', 'A'),
      node('3', 'andGate', 'AND Gate'),
      node('4', 'output', 'Output'),
    ];
    const edges = [
      edge('e1', '1', '3', 'a'),
      edge('e2', '2', '3', 'b'),
      edge('e3', '3', '4'),
    ];
    const doc = exportNetlist(nodes, edges, 'x');
    expect(doc.io.inputs).toEqual(['A', 'A_2']);
    expect(doc.components[0].inputs).toEqual(['A', 'A_2']);
  });
});

describe('parseNetlist — reconstruction', () => {
  test('rebuilds the spec example with correct nodes, edges, and layers', () => {
    const result = parseNetlist(specNetlist());
    if (!result.ok) throw new Error(result.errors.join('; '));

    expect(result.circuitName).toBe('Spec Example');
    const byType = (t: string): number => result.nodes.filter((n) => n.type === t).length;
    expect(byType('input')).toBe(3);
    expect(byType('andGate')).toBe(1);
    expect(byType('orGate')).toBe(1);
    expect(byType('output')).toBe(1);
    expect(result.edges).toHaveLength(5);

    // Auto-layout: inputs at x=0, AND one layer right, OR right of AND, output last.
    const x = (key: string): number => result.nodes.find((n) => n.key === key)!.x;
    expect(x('in:A')).toBe(0);
    expect(x('comp:U1')).toBeGreaterThan(x('in:A'));
    expect(x('comp:U2')).toBeGreaterThan(x('comp:U1'));
    expect(x('out:0:OUT')).toBeGreaterThan(x('comp:U2'));

    // Gate inputs land on handles 'a' then 'b' in netlist order.
    const u1Edges = result.edges.filter((e) => e.targetKey === 'comp:U1');
    expect(u1Edges.map((e) => e.targetHandle)).toEqual(['a', 'b']);
  });

  test('round-trips its own export', () => {
    const { nodes, edges } = andCircuit();
    const result = parseNetlist(exportNetlist(nodes, edges, 'RT'));
    if (!result.ok) throw new Error(result.errors.join('; '));
    expect(result.nodes.map((n) => n.type).sort()).toEqual([
      'andGate',
      'input',
      'input',
      'output',
    ]);
    expect(result.edges).toHaveLength(3);
  });

  test('honors explicit x/y on components', () => {
    const doc = specNetlist();
    doc.components[0].x = 1234;
    doc.components[0].y = 567;
    const result = parseNetlist(doc);
    if (!result.ok) throw new Error(result.errors.join('; '));
    const u1 = result.nodes.find((n) => n.key === 'comp:U1')!;
    expect(u1.x).toBe(1234);
    expect(u1.y).toBe(567);
  });
});

describe('parseNetlist — validation errors', () => {
  test('rejects non-object documents', () => {
    const result = parseNetlist([1, 2, 3]);
    expect(result).toEqual({ ok: false, errors: ['netlist must be a JSON object'] });
  });

  test('reports missing required fields', () => {
    const result = parseNetlist({});
    if (result.ok) throw new Error('expected failure');
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "'circuit_name' must be a non-empty string",
        "'components' must be an array",
        "'nets' must be an array of strings",
        "'io' must be an object with 'inputs' and 'outputs' string arrays",
      ])
    );
  });

  test('reports a dangling net reference', () => {
    const doc = specNetlist();
    doc.components[1].inputs = ['N2', 'C'];
    const result = parseNetlist(doc);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors).toContain("net 'N2' referenced but never defined");
  });

  test('reports duplicate component ids', () => {
    const doc = specNetlist();
    doc.components[1].id = 'U1';
    const result = parseNetlist(doc);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors).toContain("duplicate component id 'U1'");
  });

  test('reports unknown component types', () => {
    const doc = specNetlist();
    doc.components[0].type = 'XAND_GATE';
    const result = parseNetlist(doc);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors).toContain("component 'U1' has unknown type 'XAND_GATE'");
  });

  test('reports wrong input arity', () => {
    const doc = specNetlist();
    doc.components[0].type = 'NOT_GATE';
    const result = parseNetlist(doc);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors).toContain("component 'U1' (NOT_GATE) expects 1 input, got 2");
  });

  test('reports multiply-driven and never-driven nets', () => {
    const doc = specNetlist();
    doc.components[1].output = 'N1'; // N1 now driven by U1 and U2; OUT never driven.
    const result = parseNetlist(doc);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors).toContain("net 'N1' is driven by multiple sources");
    expect(result.errors).toContain(
      "net 'OUT' is never driven (not an io input and no component output)"
    );
  });

  test('reports combinational loops', () => {
    const result = parseNetlist({
      circuit_name: 'Loop',
      components: [
        { id: 'U1', type: 'AND_GATE', inputs: ['A', 'Y'], output: 'X' },
        { id: 'U2', type: 'OR_GATE', inputs: ['X', 'A'], output: 'Y' },
      ],
      nets: ['A', 'X', 'Y'],
      io: { inputs: ['A'], outputs: ['Y'] },
    });
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.some((e) => e.includes('combinational loop'))).toBe(true);
  });
});
