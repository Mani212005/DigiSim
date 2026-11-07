/**
 * @file digital.test.ts
 * @description Unit tests for digital circuit evaluation and relaxation simulation,
 * including hierarchical components, input handle ordering, and adder settling.
 */

import { runSimulation } from './digital';
import type { DigiEdge, DigiNode } from '../../types';

describe('runSimulation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('evaluates a basic hierarchical customComponent node', () => {
    // Define custom component: a simple NOT gate
    const customComponent = {
      id: 'my-not-gate',
      name: 'My NOT Gate',
      category: 'User Library',
      pins: [
        { id: 'in', label: 'IN', type: 'INPUT', side: 'LEFT' },
        { id: 'out', label: 'OUT', type: 'OUTPUT', side: 'RIGHT' }
      ],
      subcircuit: {
        nodes: [
          { id: 'in', type: 'input', data: { label: 'in', value: 0 }, position: { x: 0, y: 0 } },
          { id: 'not1', type: 'notGate', data: { label: 'not', value: 0 }, position: { x: 100, y: 0 } },
          { id: 'out', type: 'output', data: { label: 'out', value: 0 }, position: { x: 200, y: 0 } }
        ] as DigiNode[],
        edges: [
          { id: 'e1', source: 'in', target: 'not1', targetHandle: 'a' },
          { id: 'e2', source: 'not1', target: 'out' }
        ] as DigiEdge[]
      }
    };
    
    localStorage.setItem('customComponents', JSON.stringify([customComponent]));

    const nodes: DigiNode[] = [
      { id: 'in1', type: 'input', data: { label: 'A', value: 1 }, position: { x: 0, y: 0 } },
      { id: 'custom1', type: 'customComponent', data: { label: 'custom', subcircuitRef: 'my-not-gate' }, position: { x: 100, y: 0 } },
      { id: 'out1', type: 'output', data: { label: 'B' }, position: { x: 200, y: 0 } }
    ];
    
    const edges: DigiEdge[] = [
      { id: 'e_in', source: 'in1', target: 'custom1', targetHandle: 't:in' },
      { id: 'e_out', source: 'custom1', target: 'out1', sourceHandle: 's:out' }
    ];

    const updated = runSimulation(nodes, edges);
    
    // NOT(1) = 0
    expect(updated.find(n => n.id === 'custom1')?.data.value).toEqual({ out: 0 });
    expect(updated.find(n => n.id === 'out1')?.data.value).toBe(0);
  });

  test('guards against cyclic subcircuit inclusion', () => {
    // custom1 uses custom1
    const customComponent = {
      id: 'my-recursive',
      name: 'Recursive',
      category: 'User Library',
      pins: [
        { id: 'in', type: 'INPUT' },
        { id: 'out', type: 'OUTPUT' }
      ],
      subcircuit: {
        nodes: [
          { id: 'in', type: 'input', data: { label: 'in', value: 0 }, position: { x: 0, y: 0 } },
          { id: 'recurse', type: 'customComponent', data: { label: 'custom', subcircuitRef: 'my-recursive' }, position: { x: 100, y: 0 } },
          { id: 'out', type: 'output', data: { label: 'out', value: 0 }, position: { x: 200, y: 0 } }
        ] as DigiNode[],
        edges: [
          { id: 'e1', source: 'in', target: 'recurse', targetHandle: 't:in' },
          { id: 'e2', source: 'recurse', target: 'out', sourceHandle: 's:out' }
        ] as DigiEdge[]
      }
    };
    localStorage.setItem('customComponents', JSON.stringify([customComponent]));

    const nodes: DigiNode[] = [
      { id: 'in1', type: 'input', data: { label: 'A', value: 1 }, position: { x: 0, y: 0 } },
      { id: 'custom1', type: 'customComponent', data: { label: 'custom', subcircuitRef: 'my-recursive' }, position: { x: 100, y: 0 } },
    ];
    const edges: DigiEdge[] = [
      { id: 'e_in', source: 'in1', target: 'custom1', targetHandle: 't:in' }
    ];

    // Should terminate gracefully and not infinite loop. Result will just be 'Z' or old value
    const updated = runSimulation(nodes, edges);
    expect(updated.length).toBe(2);
  });

  test('orders gate inputs by target handle regardless of edge list order', () => {
    // mux: a = sel, b = data0, c = data1. Edges are deliberately listed c, b, a.
    const nodes: DigiNode[] = [
      { id: 'sel', type: 'input', data: { label: 'sel', value: 1 }, position: { x: 0, y: 0 } },
      { id: 'd0', type: 'input', data: { label: 'd0', value: 0 }, position: { x: 0, y: 0 } },
      { id: 'd1', type: 'input', data: { label: 'd1', value: 1 }, position: { x: 0, y: 0 } },
      { id: 'mux', type: 'mux', data: { label: 'mux' }, position: { x: 0, y: 0 } },
      { id: 'out', type: 'output', data: { label: 'out' }, position: { x: 0, y: 0 } },
    ];
    const edges: DigiEdge[] = [
      { id: 'e3', source: 'd1', target: 'mux', targetHandle: 'c' },
      { id: 'e2', source: 'd0', target: 'mux', targetHandle: 'b' },
      { id: 'e1', source: 'sel', target: 'mux', targetHandle: 'a' },
      { id: 'e4', source: 'mux', target: 'out' },
    ];

    expect(runSimulation(nodes, edges).find((n) => n.id === 'out')?.data.value).toBe(1);
    nodes[0] = { ...nodes[0], data: { ...nodes[0].data, value: 0 } };
    expect(runSimulation(nodes, edges).find((n) => n.id === 'out')?.data.value).toBe(0);
  });

  test('settles a ripple-carry adder with nodes listed in reverse dependency order', () => {
    const bits = 8;
    const a = 0b10110101;
    const b = 0b01101110;
    const nodes: DigiNode[] = [];
    const edges: DigiEdge[] = [];
    /**
     * Append a directed edge targeting a handle.
     * @param source - Source node ID
     * @param target - Target node ID
     * @param handle - Target handle name
     */
    const wire = (source: string, target: string, handle: string): void => {
      edges.push({ id: `e${edges.length}`, source, target, targetHandle: handle } as DigiEdge);
    };

    /**
     * Append a circuit node.
     * @param id - Unique node ID
     * @param type - Component type
     * @param value - Optional initial value
     */
    const node = (id: string, type: string, value?: number): void => {
      nodes.push({ id, type, data: { label: id, ...(value === undefined ? {} : { value }) }, position: { x: 0, y: 0 } } as DigiNode);
    };
    node('cin', 'input', 0);
    let carry = 'cin';
    for (let i = 0; i < bits; i++) {
      node(`a${i}`, 'input', (a >> i) & 1);
      node(`b${i}`, 'input', (b >> i) & 1);
      node(`x${i}`, 'xorGate');
      node(`s${i}`, 'xorGate');
      node(`n1${i}`, 'andGate');
      node(`n2${i}`, 'andGate');
      node(`c${i}`, 'orGate');
      node(`o${i}`, 'output');
      wire(`a${i}`, `x${i}`, 'a');
      wire(`b${i}`, `x${i}`, 'b');
      wire(`x${i}`, `s${i}`, 'a');
      wire(carry, `s${i}`, 'b');
      wire(`a${i}`, `n1${i}`, 'a');
      wire(`b${i}`, `n1${i}`, 'b');
      wire(`x${i}`, `n2${i}`, 'a');
      wire(carry, `n2${i}`, 'b');
      wire(`n1${i}`, `c${i}`, 'a');
      wire(`n2${i}`, `c${i}`, 'b');
      wire(`s${i}`, `o${i}`, 'a');
      carry = `c${i}`;
    }
    node('cout', 'output');
    wire(carry, 'cout', 'a');

    // Sum bits and carry-out must match integer addition in either node order.
    for (const ordered of [nodes, [...nodes].reverse()]) {
      const byId = new Map(runSimulation(ordered, edges).map((n) => [n.id, n.data.value]));
      let sum = 0;
      for (let i = 0; i < bits; i++) sum |= (byId.get(`o${i}`) as number) << i;
      sum |= (byId.get('cout') as number) << bits;
      expect(sum).toBe(a + b);
    }
  });
});
