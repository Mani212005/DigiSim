/**
 * @file circuitAnalysis.test.ts
 * @description Tests for circuit discovery, truth-table enumeration, and netlist
 * generation — the data artifacts behind the netlist sidebar and Ctrl+J terminal.
 */

import {
  buildNetlist,
  findCircuits,
  generateTruthTable,
} from './circuitAnalysis';
import type { DigiEdge, DigiNode } from '../types';

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

/** A two-input gate feeding one output: A,B → gate → Y. */
const twoInputCircuit = (gateType: string): { nodes: DigiNode[]; edges: DigiEdge[] } => ({
  nodes: [
    node('1', 'input', 'A'),
    node('2', 'input', 'B'),
    node('3', gateType, 'Gate'),
    node('4', 'output', 'Y'),
  ],
  edges: [
    edge('e1', '1', '3', 'a'),
    edge('e2', '2', '3', 'b'),
    edge('e3', '3', '4'),
  ],
});

/** Extract the single-output column values across all rows. */
const outputColumn = (gateType: string): number[] => {
  const { nodes, edges } = twoInputCircuit(gateType);
  const [circuit] = findCircuits(nodes, edges);
  return generateTruthTable(circuit, nodes, edges).rows.map((r) => r.outputs[0]);
};

describe('truth-table enumeration', () => {
  test('AND yields 0,0,0,1 over 00,01,10,11', () => {
    expect(outputColumn('andGate')).toEqual([0, 0, 0, 1]);
  });

  test('OR yields 0,1,1,1', () => {
    expect(outputColumn('orGate')).toEqual([0, 1, 1, 1]);
  });

  test('XOR yields 0,1,1,0', () => {
    expect(outputColumn('xorGate')).toEqual([0, 1, 1, 0]);
  });

  test('columns are labelled and ordered A,B → Y', () => {
    const { nodes, edges } = twoInputCircuit('andGate');
    const [circuit] = findCircuits(nodes, edges);
    const table = generateTruthTable(circuit, nodes, edges);
    expect(table.inputs.map((c) => c.label)).toEqual(['A', 'B']);
    expect(table.outputs.map((c) => c.label)).toEqual(['Y']);
    expect(table.rows).toHaveLength(4);
    expect(table.truncated).toBe(false);
  });
});

describe('findCircuits', () => {
  test('splits two disconnected circuits and names them in order', () => {
    const a = twoInputCircuit('andGate');
    const b = {
      nodes: [
        node('5', 'input', 'C'),
        node('6', 'input', 'D'),
        node('7', 'orGate', 'Gate'),
        node('8', 'output', 'Z'),
      ],
      edges: [edge('e4', '5', '7', 'a'), edge('e5', '6', '7', 'b'), edge('e6', '7', '8')],
    };
    const circuits = findCircuits([...a.nodes, ...b.nodes], [...a.edges, ...b.edges]);
    expect(circuits).toHaveLength(2);
    expect(circuits.map((c) => c.name)).toEqual(['Circuit 1', 'Circuit 2']);
  });

  test('excludes fragments lacking an input or an output', () => {
    // Input → gate, but no output node connected.
    const nodes = [node('1', 'input', 'A'), node('2', 'notGate', 'Gate')];
    const edges = [edge('e1', '1', '2', 'a')];
    expect(findCircuits(nodes, edges)).toHaveLength(0);
  });
});

describe('buildNetlist', () => {
  test('renders gates, output, and input nets in U1/OUT1 form', () => {
    const { nodes, edges } = twoInputCircuit('andGate');
    const [circuit] = findCircuits(nodes, edges);
    const netlist = buildNetlist(circuit, nodes, edges);
    expect(netlist.inputs).toEqual(['A', 'B']);
    expect(netlist.text).toContain('U1: AND_GATE  in=[A, B]  out=n1');
    expect(netlist.text).toContain('OUT1: OUTPUT  in=[n1]');
  });
});
