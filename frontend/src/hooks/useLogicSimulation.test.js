/**
 * @file useLogicSimulation.test.js
 * @description Truth-table tests for all 7 gate types and Kahn's algorithm edge cases
 * in the useLogicSimulation hook.
 */

import { renderHook } from '@testing-library/react';
import { useLogicSimulation } from './useLogicSimulation';

/** Build a minimal node/edge setup and return the computed output value. */
const simulate = (gateType, inputValues) => {
  const { result } = renderHook(() => useLogicSimulation());
  const { simulateCircuit } = result.current;

  const inputNodes = inputValues.map((val, i) => ({
    id: `in${i}`,
    type: 'input',
    data: { label: `Input ${i}`, value: val },
    position: { x: 0, y: i * 100 },
  }));

  const gateNode = {
    id: 'gate',
    type: gateType,
    data: { label: 'Gate', value: 0 },
    position: { x: 200, y: 0 },
  };

  const outputNode = {
    id: 'out',
    type: 'output',
    data: { label: 'Output', value: 0 },
    position: { x: 400, y: 0 },
  };

  const handleIds = ['a', 'b'];
  const inputEdges = inputNodes.map((n, i) => ({
    id: `e-in${i}-gate`,
    source: n.id,
    target: 'gate',
    targetHandle: handleIds[i] || 'a',
  }));

  const outputEdge = { id: 'e-gate-out', source: 'gate', target: 'out' };

  const nodes = [...inputNodes, gateNode, outputNode];
  const edges = [...inputEdges, outputEdge];

  const updated = simulateCircuit(nodes, edges);
  return updated.find(n => n.id === 'gate').data.value;
};

// ---------------------------------------------------------------------------
// AND gate
// ---------------------------------------------------------------------------
describe('AND gate truth table', () => {
  test('0 AND 0 = 0', () => expect(simulate('andGate', [0, 0])).toBe(0));
  test('0 AND 1 = 0', () => expect(simulate('andGate', [0, 1])).toBe(0));
  test('1 AND 0 = 0', () => expect(simulate('andGate', [1, 0])).toBe(0));
  test('1 AND 1 = 1', () => expect(simulate('andGate', [1, 1])).toBe(1));
});

// ---------------------------------------------------------------------------
// OR gate
// ---------------------------------------------------------------------------
describe('OR gate truth table', () => {
  test('0 OR 0 = 0', () => expect(simulate('orGate', [0, 0])).toBe(0));
  test('0 OR 1 = 1', () => expect(simulate('orGate', [0, 1])).toBe(1));
  test('1 OR 0 = 1', () => expect(simulate('orGate', [1, 0])).toBe(1));
  test('1 OR 1 = 1', () => expect(simulate('orGate', [1, 1])).toBe(1));
});

// ---------------------------------------------------------------------------
// NOT gate
// ---------------------------------------------------------------------------
describe('NOT gate truth table', () => {
  test('NOT 0 = 1', () => expect(simulate('notGate', [0])).toBe(1));
  test('NOT 1 = 0', () => expect(simulate('notGate', [1])).toBe(0));
});

// ---------------------------------------------------------------------------
// NAND gate
// ---------------------------------------------------------------------------
describe('NAND gate truth table', () => {
  test('0 NAND 0 = 1', () => expect(simulate('nandGate', [0, 0])).toBe(1));
  test('0 NAND 1 = 1', () => expect(simulate('nandGate', [0, 1])).toBe(1));
  test('1 NAND 0 = 1', () => expect(simulate('nandGate', [1, 0])).toBe(1));
  test('1 NAND 1 = 0', () => expect(simulate('nandGate', [1, 1])).toBe(0));
});

// ---------------------------------------------------------------------------
// NOR gate
// ---------------------------------------------------------------------------
describe('NOR gate truth table', () => {
  test('0 NOR 0 = 1', () => expect(simulate('norGate', [0, 0])).toBe(1));
  test('0 NOR 1 = 0', () => expect(simulate('norGate', [0, 1])).toBe(0));
  test('1 NOR 0 = 0', () => expect(simulate('norGate', [1, 0])).toBe(0));
  test('1 NOR 1 = 0', () => expect(simulate('norGate', [1, 1])).toBe(0));
});

// ---------------------------------------------------------------------------
// XOR gate
// ---------------------------------------------------------------------------
describe('XOR gate truth table', () => {
  test('0 XOR 0 = 0', () => expect(simulate('xorGate', [0, 0])).toBe(0));
  test('0 XOR 1 = 1', () => expect(simulate('xorGate', [0, 1])).toBe(1));
  test('1 XOR 0 = 1', () => expect(simulate('xorGate', [1, 0])).toBe(1));
  test('1 XOR 1 = 0', () => expect(simulate('xorGate', [1, 1])).toBe(0));
});

// ---------------------------------------------------------------------------
// XNOR gate
// ---------------------------------------------------------------------------
describe('XNOR gate truth table', () => {
  test('0 XNOR 0 = 1', () => expect(simulate('xnorGate', [0, 0])).toBe(1));
  test('0 XNOR 1 = 0', () => expect(simulate('xnorGate', [0, 1])).toBe(0));
  test('1 XNOR 0 = 0', () => expect(simulate('xnorGate', [1, 0])).toBe(0));
  test('1 XNOR 1 = 1', () => expect(simulate('xnorGate', [1, 1])).toBe(1));
});

// ---------------------------------------------------------------------------
// Kahn's algorithm edge cases
// ---------------------------------------------------------------------------
describe('simulateCircuit edge cases', () => {
  test('disconnected gate defaults to 0', () => {
    const { result } = renderHook(() => useLogicSimulation());
    const { simulateCircuit } = result.current;

    const nodes = [
      { id: 'a', type: 'andGate', data: { label: 'A', value: 0 }, position: { x: 0, y: 0 } },
    ];
    const updated = simulateCircuit(nodes, []);
    expect(updated[0].data.value).toBe(0);
  });

  test('chained gates: AND → NOT propagates correctly', () => {
    const { result } = renderHook(() => useLogicSimulation());
    const { simulateCircuit } = result.current;

    const nodes = [
      { id: 'in0', type: 'input', data: { label: 'A', value: 1 }, position: { x: 0, y: 0 } },
      { id: 'in1', type: 'input', data: { label: 'B', value: 1 }, position: { x: 0, y: 100 } },
      { id: 'and', type: 'andGate', data: { label: 'AND', value: 0 }, position: { x: 200, y: 0 } },
      { id: 'not', type: 'notGate', data: { label: 'NOT', value: 0 }, position: { x: 400, y: 0 } },
    ];
    const edges = [
      { id: 'e1', source: 'in0', target: 'and', targetHandle: 'a' },
      { id: 'e2', source: 'in1', target: 'and', targetHandle: 'b' },
      { id: 'e3', source: 'and', target: 'not', targetHandle: 'a' },
    ];
    const updated = simulateCircuit(nodes, edges);
    expect(updated.find(n => n.id === 'and').data.value).toBe(1);  // 1 AND 1 = 1
    expect(updated.find(n => n.id === 'not').data.value).toBe(0);  // NOT 1 = 0
  });

  test('output node takes value from its source', () => {
    const { result } = renderHook(() => useLogicSimulation());
    const { simulateCircuit } = result.current;

    const nodes = [
      { id: 'in', type: 'input', data: { label: 'A', value: 1 }, position: { x: 0, y: 0 } },
      { id: 'out', type: 'output', data: { label: 'Out', value: 0 }, position: { x: 200, y: 0 } },
    ];
    const edges = [{ id: 'e1', source: 'in', target: 'out' }];
    const updated = simulateCircuit(nodes, edges);
    expect(updated.find(n => n.id === 'out').data.value).toBe(1);
  });
});
