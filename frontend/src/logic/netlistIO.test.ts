/**
 * @file netlistIO.test.ts
 * @description Tests for canonical JSON netlist export/import — round-trip fidelity,
 * and structural checks for the new explicitly declared components/connections format.
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
const edge = (id: string, source: string, target: string, handle?: string, sourceHandle?: string): DigiEdge => ({
  id,
  source,
  target,
  targetHandle: handle ?? null,
  sourceHandle: sourceHandle ?? null,
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

/** Spec representation of the two-gate example: (A AND B) → N1; (N1 OR C) → OUT. */
const specNetlist = (): NetlistExportJSON => ({
  circuit_name: 'Spec Example',
  components: [
    { id: 'in_1', type: 'INPUT', label: 'A', x: 0, y: 0 },
    { id: 'in_2', type: 'INPUT', label: 'B', x: 0, y: 100 },
    { id: 'in_3', type: 'INPUT', label: 'C', x: 0, y: 200 },
    { id: 'and_1', type: 'ANDGATE', label: 'AND Gate', x: 100, y: 50 },
    { id: 'or_1', type: 'ORGATE', label: 'OR Gate', x: 200, y: 100 },
    { id: 'out_1', type: 'OUTPUT', label: 'OUT', x: 300, y: 100 },
  ],
  connections: [
    { from: 'in_1.out', to: 'and_1.a' },
    { from: 'in_2.out', to: 'and_1.b' },
    { from: 'and_1.out', to: 'or_1.a' },
    { from: 'in_3.out', to: 'or_1.b' },
    { from: 'or_1.out', to: 'out_1.in' },
  ],
});

describe('exportNetlist', () => {
  test('serializes the default AND circuit into the explicit components/connections schema', () => {
    const { nodes, edges } = andCircuit();
    const doc = exportNetlist(nodes, edges, 'My Circuit');
    expect(doc).toEqual({
      circuit_name: 'My Circuit',
      components: [
        { id: 'input_1', type: 'INPUT', label: 'Input A', x: 100, y: 0 },
        { id: 'input_2', type: 'INPUT', label: 'Input B', x: 200, y: 0 },
        { id: 'andGate_3', type: 'ANDGATE', label: 'AND Gate', x: 300, y: 0 },
        { id: 'output_4', type: 'OUTPUT', label: 'Output', x: 400, y: 0 },
      ],
      connections: [
        { from: 'input_1.out', to: 'andGate_3.a' },
        { from: 'input_2.out', to: 'andGate_3.b' },
        { from: 'andGate_3.out', to: 'output_4.in' },
      ]
    });
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
    const in1 = result.nodes.find((n) => n.key === 'comp:in_1')!;
    expect(in1.x).toBe(1234);
    expect(in1.y).toBe(567);
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
        "'connections' must be an array",
      ])
    );
  });

  test('reports duplicate component ids', () => {
    const doc = specNetlist();
    doc.components[1].id = 'in_1';
    const result = parseNetlist(doc);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors).toContain("duplicate component id 'in_1'");
  });

  test('reports connection from unknown component', () => {
    const doc = specNetlist();
    doc.connections[0].from = 'unknown.out';
    const result = parseNetlist(doc);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors).toContain("connection from unknown component 'unknown'");
  });
});
