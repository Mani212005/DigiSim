/**
 * @file digital.ts
 * @description Digital circuit evaluation — Relaxation algorithm propagates 0/1/Z/X
 * logic values gate-by-gate until stable, resolving feedback loops and latches.
 */

import type { DigiEdge, DigiNode } from '../../types';
import { evaluateGate } from './evaluateGate';

export type SimulateCircuit = (
  currentNodes: DigiNode[],
  currentEdges: DigiEdge[],
  timeSeconds?: number
) => DigiNode[];

export const runSimulation: SimulateCircuit = (currentNodes, currentEdges, timeSeconds = 0) => {
  const newNodes: DigiNode[] = currentNodes.map((node) => ({
    ...node,
    data: { ...node.data },
  }));
  const nodeMap = new Map<string, DigiNode>(newNodes.map((node) => [node.id, node]));

  let changed = true;
  let iterations = 0;
  const MAX_ITERATIONS = 50; // Enough to settle combinational loops and latches

  // Initialize clock nodes
  for (const node of newNodes) {
    if (node.type === 'clock') {
      const freq = Number(node.data.param) || 1;
      const period = 1 / freq;
      node.data.value = (timeSeconds % period) < (period / 2) ? 1 : 0;
    }
  }

  while (changed && iterations < MAX_ITERATIONS) {
    changed = false;
    iterations++;

    for (const node of newNodes) {
      if (node.type === 'input' || node.type === 'clock' || node.type === 'vsource' || node.type === 'ground' || node.type === 'resistor' || node.type === 'potentiometer' || node.type === 'analogSwitch') {
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
        return src && src.data.value !== undefined ? src.data.value : 'Z';
      });

      const oldVal = node.data.value;
      let newVal: number | string = 0;

      if (node.type === 'output' || node.type === 'led') {
        newVal = inputs.length > 0 ? inputs[0] : 'Z';
      } else {
        newVal = evaluateGate(node.type, inputs, oldVal);
      }

      if (newVal !== oldVal) {
        node.data.value = newVal;
        changed = true;
      }
    }
  }

  return newNodes;
};
