/**
 * @file digital.ts
 * @description Digital circuit evaluation — Relaxation algorithm propagates 0/1/Z/X
 * logic values gate-by-gate until stable, resolving feedback loops and latches.
 * Supports hierarchical subcircuit evaluation via customComponents and
 * switch-level CMOS transistor networks (NMOS/PMOS + supplies) so hand-wired
 * transistor gates simulate to the correct truth table.
 */

import type { DigiEdge, DigiNode } from '../../types';
import { evaluateGate } from './evaluateGate';
import { solveSwitchNets } from './switchLevel';

export type SimulateCircuit = (
  currentNodes: DigiNode[],
  currentEdges: DigiEdge[],
  timeSeconds?: number
) => DigiNode[];

export const runSimulation: SimulateCircuit = (currentNodes, currentEdges, timeSeconds = 0) => {
  return runSimulationWithCycleGuard(currentNodes, currentEdges, timeSeconds, new Set());
};

const runSimulationWithCycleGuard = (
  currentNodes: DigiNode[],
  currentEdges: DigiEdge[],
  timeSeconds: number,
  visitedSubcircuits: Set<string>
): DigiNode[] => {
  const newNodes: DigiNode[] = currentNodes.map((node) => ({
    ...node,
    data: { ...node.data },
  }));
  const nodeMap = new Map<string, DigiNode>(newNodes.map((node) => [node.id, node]));

  let changed = true;
  let iterations = 0;
  const MAX_ITERATIONS = 50; // Enough to settle combinational loops and latches

  // Initialize clock nodes (legacy 'clock' and current 'clockSource').
  for (const node of newNodes) {
    if (node.type === 'clock' || node.type === 'clockSource') {
      const freq = Number(node.data.param) || 1;
      const period = 1 / freq;
      node.data.value = (timeSeconds % period) < (period / 2) ? 1 : 0;
    }
  }

  // Load custom components for hierarchy
  let customComponents: import('../../types').CustomComponentDefinition[] = [];
  try {
    const raw = localStorage.getItem('customComponents');
    if (raw) customComponents = JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to load customComponents for simulation');
  }

  while (changed && iterations < MAX_ITERATIONS) {
    changed = false;
    iterations++;

    for (const node of newNodes) {
      if (node.type === 'input' || node.type === 'clock' || node.type === 'clockSource' || node.type === 'vsource' || node.type === 'ground' || node.type === 'resistor' || node.type === 'potentiometer' || node.type === 'analogSwitch' || node.type === 'nmos' || node.type === 'pmos') {
        continue;
      }

      const incomingEdges = currentEdges.filter((edge) => edge.target === node.id);
      
      // Sort edges by handle name ('a', 'b', 'c', ...) or index
      incomingEdges.sort((e1, e2) => {
        const h1 = e1.targetHandle || '';
        const h2 = e2.targetHandle || '';
        return h1.localeCompare(h2);
      });

      const inputs = incomingEdges.map((edge) => {
        const src = nodeMap.get(edge.source);
        if (!src) return 'Z';

        if (src.type === 'customComponent' && typeof src.data.value === 'object' && src.data.value !== null) {
          const outputPinId = edge.sourceHandle?.replace('s:', '');
          return outputPinId ? ((src.data.value as Record<string, number | string>)[outputPinId] ?? 'Z') : 'Z';
        }

        return src.data.value !== undefined ? src.data.value : 'Z';
      });

      // Update input port indicators for gate visual shell
      const edgeA = incomingEdges.find((e) => e.targetHandle === 'a') || incomingEdges[0];
      const edgeB = incomingEdges.find((e) => e.targetHandle === 'b') || incomingEdges[1];
      let valA: number | string = 0;
      let valB: number | string = 0;

      if (edgeA) {
        const srcA = nodeMap.get(edgeA.source);
        if (srcA) {
          if (srcA.type === 'customComponent' && typeof srcA.data.value === 'object' && srcA.data.value !== null) {
             const outputPinId = edgeA.sourceHandle?.replace('s:', '');
             valA = outputPinId ? ((srcA.data.value as Record<string, number | string>)[outputPinId] ?? 0) : 0;
          } else {
             valA = srcA.data.value !== undefined ? srcA.data.value as string | number : 0;
          }
        }
      }
      
      if (edgeB) {
        const srcB = nodeMap.get(edgeB.source);
        if (srcB) {
          if (srcB.type === 'customComponent' && typeof srcB.data.value === 'object' && srcB.data.value !== null) {
             const outputPinId = edgeB.sourceHandle?.replace('s:', '');
             valB = outputPinId ? ((srcB.data.value as Record<string, number | string>)[outputPinId] ?? 0) : 0;
          } else {
             valB = srcB.data.value !== undefined ? srcB.data.value as string | number : 0;
          }
        }
      }

      node.data.inputA = valA === 1 ? 1 : 0;
      node.data.a = valA === 1 ? 1 : 0;
      node.data.inputB = valB === 1 ? 1 : 0;
      node.data.b = valB === 1 ? 1 : 0;

      let newVal: number | string | Record<string, number | string> = 0;

      if (node.type === 'output' || node.type === 'led') {
        newVal = inputs.length > 0 ? inputs[0] : 'Z';
      } else if (node.type === 'customComponent' && node.data.subcircuitRef) {
        if (visitedSubcircuits.has(node.data.subcircuitRef)) {
          // cycle freeze guard
          newVal = node.data.value || {};
        } else {
          const def = customComponents.find(c => c.id === node.data.subcircuitRef);
          if (def) {
            // Prepare inputs
            const internalNodes = JSON.parse(JSON.stringify(def.subcircuit.nodes)) as DigiNode[];
            const internalEdges = JSON.parse(JSON.stringify(def.subcircuit.edges)) as DigiEdge[];
            
            // Map external inputs to internal input nodes
            const internalInputNodes = internalNodes.filter(n => n.type === 'input');
            const newVisited = new Set(visitedSubcircuits);
            newVisited.add(node.data.subcircuitRef);

            // Connect external values via targetHandles
            // edge.targetHandle e.g. "t:pin-xyz"
            for (const edge of incomingEdges) {
              const pinId = edge.targetHandle?.replace('t:', '');
              const src = nodeMap.get(edge.source);
              let val: number | string = 'Z';
              if (src) {
                if (src.type === 'customComponent' && typeof src.data.value === 'object' && src.data.value !== null) {
                  const outId = edge.sourceHandle?.replace('s:', '');
                  val = outId ? ((src.data.value as Record<string, number | string>)[outId] ?? 'Z') : 'Z';
                } else {
                  val = (src.data.value as string | number) ?? 'Z';
                }
              }
              // find the internal node that corresponds to this input pin
              // The internal nodes should have some identifier for the pin. Let's assume input nodes have label === pinId or data.id === pinId
              // The easiest convention is that inside the subcircuit, the input node's id or label matches pinId.
              const internalIn = internalInputNodes.find(n => n.id === pinId || n.data.label === pinId);
              if (internalIn) {
                internalIn.data.value = val;
              }
            }

            // run recursive simulation
            const simulatedInternal = runSimulationWithCycleGuard(internalNodes, internalEdges, timeSeconds, newVisited);
            
            // Map internal outputs back to external output pins
            const internalOutputNodes = simulatedInternal.filter(n => n.type === 'output');
            const outputs: Record<string, number | string> = {};
            for (const outPin of def.pins.filter(p => p.type === 'OUTPUT')) {
              const internalOut = internalOutputNodes.find(n => n.id === outPin.id || n.data.label === outPin.id);
              if (internalOut) {
                outputs[outPin.id] = (internalOut.data.value as string | number) ?? 'Z';
              } else {
                outputs[outPin.id] = 'Z';
              }
            }
            newVal = outputs;
          } else {
             newVal = node.data.value || {};
          }
        }
      } else {
        const oldVal = node.data.value as number | string | undefined;
        newVal = evaluateGate(node.type, inputs as (string | number)[], oldVal as string | number | undefined);
      }

      // Check if value changed
      const oldVal = node.data.value;
      let isDifferent = false;
      if (typeof newVal === 'object' && typeof oldVal === 'object' && newVal !== null && oldVal !== null) {
        for (const k of Object.keys(newVal)) {
          if (newVal[k] !== oldVal[k]) isDifferent = true;
        }
      } else if (newVal !== oldVal) {
        isDifferent = true;
      }

      if (isDifferent) {
        node.data.value = newVal;
        changed = true;
      }
    }
  }

  // Switch-level CMOS pass: hand-wired NMOS/PMOS + supplies resolve to
  // digital levels on output probes. Only definitive 0/1 override the
  // gate pass, so pure gate circuits are untouched.
  if (newNodes.some((n) => n.type === 'nmos' || n.type === 'pmos')) {
    try {
      const liveMap = new Map<string, DigiNode>(newNodes.map((node) => [node.id, node]));
      const solved = solveSwitchNets(newNodes, currentEdges, liveMap);
      for (const node of newNodes) {
        if (node.type !== 'output') continue;
        const sw = solved.get(`${node.id}`);
        if (sw === 0 || sw === 1) {
          if (node.data.value !== sw) node.data.value = sw;
        } else if (sw === 'X') {
          if (node.data.value !== 'X') node.data.value = 'X';
        }
      }
    } catch (e) {
      console.warn('Switch-level solve failed, keeping gate results');
    }
  }

  return newNodes;
};
