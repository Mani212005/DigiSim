/**
 * @file switchLevel.test.ts
 * @description Verify hand-wired CMOS NAND simulates to the correct truth table.
 */
import { runSimulation } from './digital';
import type { DigiEdge, DigiNode } from '../../types';

function nandNodes(a: number, b: number): { nodes: DigiNode[]; edges: DigiEdge[] } {
  const nodes: DigiNode[] = [
    { id: 'inA', type: 'input', position: { x: 0, y: 0 }, data: { label: 'A', value: a } },
    { id: 'inB', type: 'input', position: { x: 0, y: 100 }, data: { label: 'B', value: b } },
    { id: 'vdd', type: 'vsource', position: { x: 200, y: 0 }, data: { label: 'VDD', param: 5 } },
    { id: 'gnd', type: 'ground', position: { x: 200, y: 300 }, data: { label: 'GND' } },
    { id: 'mp1', type: 'pmos', position: { x: 200, y: 50 }, data: { label: 'MP1' } },
    { id: 'mp2', type: 'pmos', position: { x: 300, y: 50 }, data: { label: 'MP2' } },
    { id: 'mn1', type: 'nmos', position: { x: 250, y: 150 }, data: { label: 'MN1' } },
    { id: 'mn2', type: 'nmos', position: { x: 250, y: 250 }, data: { label: 'MN2' } },
    { id: 'outY', type: 'output', position: { x: 400, y: 100 }, data: { label: 'Y', value: 0 } },
  ];
  const edges: DigiEdge[] = [
    { id: 'e1', source: 'inA', target: 'mp1', targetHandle: 't:g' },
    { id: 'e2', source: 'inA', target: 'mn1', targetHandle: 't:g' },
    { id: 'e3', source: 'inB', target: 'mp2', targetHandle: 't:g' },
    { id: 'e4', source: 'inB', target: 'mn2', targetHandle: 't:g' },
    { id: 'e5', source: 'vdd', sourceHandle: 's:pos', target: 'mp1', targetHandle: 't:s' },
    { id: 'e6', source: 'vdd', sourceHandle: 's:pos', target: 'mp2', targetHandle: 't:s' },
    { id: 'e7', source: 'mp1', sourceHandle: 's:d', target: 'outY' },
    { id: 'e8', source: 'mp2', sourceHandle: 's:d', target: 'outY' },
    { id: 'e9', source: 'mn1', sourceHandle: 's:d', target: 'outY' },
    { id: 'e10', source: 'mn1', sourceHandle: 's:s', target: 'mn2', targetHandle: 't:d' },
    { id: 'e11', source: 'mn2', sourceHandle: 's:s', target: 'gnd', targetHandle: 't:gnd' },
  ] as DigiEdge[];
  return { nodes, edges };
}

describe('switch-level CMOS NAND', () => {
  beforeEach(() => { localStorage.clear(); });
  it.each([
    [0, 0, 1],
    [0, 1, 1],
    [1, 0, 1],
    [1, 1, 0],
  ])('A=%i B=%i => Y=%i', (a, b, y) => {
    const { nodes, edges } = nandNodes(a, b);
    const out = runSimulation(nodes, edges);
    expect(out.find((n) => n.id === 'outY')?.data.value).toBe(y);
  });
});
