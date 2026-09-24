/**
 * @file standardCells.test.ts
 * @description Seeded transistor-built standard cells simulate to correct truth tables, including nesting.
 */
import { runSimulation } from '../simulation/digital';
import { STANDARD_CELL_DEFS, ensureStandardCellsSeeded } from './standardCells';
import type { DigiEdge, DigiNode } from '../../types';

function placeCell(cellId: string, instanceId: string, x = 200, y = 100): DigiNode {
  const def = STANDARD_CELL_DEFS.find((d) => d.id === cellId)!;
  return {
    id: instanceId,
    type: 'customComponent',
    position: { x, y },
    data: { label: def.name, value: {}, subcircuitRef: cellId },
  };
}

function bench(cellId: string, inputCount: 2 | 1, a: number, b: number): number | string {
  const nodes: DigiNode[] = [
    { id: 'A', type: 'input', position: { x: 0, y: 0 }, data: { label: 'A', value: a } },
    placeCell(cellId, 'dut'),
    { id: 'Y', type: 'output', position: { x: 400, y: 50 }, data: { label: 'Y', value: 0 } },
  ];
  const edges: DigiEdge[] = [
    { id: 'e_a', source: 'A', target: 'dut', targetHandle: inputCount === 1 ? 't:in' : 't:a' },
    { id: 'e_y', source: 'dut', sourceHandle: 's:out', target: 'Y' },
  ] as DigiEdge[];
  if (inputCount === 2) {
    nodes.splice(1, 0, { id: 'B', type: 'input', position: { x: 0, y: 120 }, data: { label: 'B', value: b } });
    edges.splice(1, 0, { id: 'e_b', source: 'B', target: 'dut', targetHandle: 't:b' } as DigiEdge);
  }
  const out = runSimulation(nodes, edges);
  const dutVal = out.find((n) => n.id === 'dut')?.data.value as Record<string, number | string>;
  void dutVal;
  return out.find((n) => n.id === 'Y')?.data.value as number | string;
}

describe('seeded standard cells', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('customComponents', JSON.stringify(STANDARD_CELL_DEFS));
  });

  it('seeds idempotently with stable std-* ids', () => {
    const all = ensureStandardCellsSeeded();
    expect(all.filter((c) => c.id.startsWith('std-'))).toHaveLength(6);
    const again = ensureStandardCellsSeeded();
    expect(again).toHaveLength(all.length);
  });

  it.each([
    [0, 1],
    [1, 0],
  ])('NOT %i => %i', (a, expected) => {
    expect(bench('std-not', 1, a, 0)).toBe(expected);
  });

  it.each([
    [0, 0, 1],
    [0, 1, 1],
    [1, 0, 1],
    [1, 1, 0],
  ])('NAND %i %i => %i', (a, b, expected) => {
    expect(bench('std-nand', 2, a, b)).toBe(expected);
  });

  it.each([
    [0, 0, 1],
    [0, 1, 0],
    [1, 0, 0],
    [1, 1, 0],
  ])('NOR %i %i => %i', (a, b, expected) => {
    expect(bench('std-nor', 2, a, b)).toBe(expected);
  });

  it.each([
    [0, 0, 0],
    [0, 1, 0],
    [1, 0, 0],
    [1, 1, 1],
  ])('AND (nested NAND+NOT) %i %i => %i', (a, b, expected) => {
    expect(bench('std-and', 2, a, b)).toBe(expected);
  });

  it.each([
    [0, 0, 0],
    [0, 1, 1],
    [1, 0, 1],
    [1, 1, 1],
  ])('OR (nested NOR+NOT) %i %i => %i', (a, b, expected) => {
    expect(bench('std-or', 2, a, b)).toBe(expected);
  });

  it.each([
    [0, 0, 0],
    [0, 1, 1],
    [1, 0, 1],
    [1, 1, 0],
  ])('XOR (nested 4xNAND) %i %i => %i', (a, b, expected) => {
    expect(bench('std-xor', 2, a, b)).toBe(expected);
  });
});
