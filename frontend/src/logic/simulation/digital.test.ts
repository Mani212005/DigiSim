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
});
