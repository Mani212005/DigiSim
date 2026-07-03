/**
 * @file useLogicSimulation.ts
 * @description Custom hook that runs full circuit evaluation on every nodes/edges change.
 * Uses Kahn's algorithm (BFS topological sort) to propagate logic values gate-by-gate.
 * All gate evaluation logic lives exclusively in evaluateGate — never in node components.
 */

import { useCallback } from 'react';
import type { DigiEdge, DigiNode } from '../types';

/**
 * Evaluate a single gate's output given its type and input values.
 * This is the single dispatch point for all gate logic in DigiSim.
 *
 * @param type - ReactFlow node type string (e.g. 'andGate', 'norGate')
 * @param inputs - Array of 0/1 input values from connected source nodes
 * @returns 0 or 1 output value
 */
const evaluateGate = (type: string | undefined, inputs: number[]): number => {
  if (inputs.length === 0) return 0;
  switch (type) {
    case 'andGate':
      return inputs.every((input) => input === 1) ? 1 : 0;
    case 'orGate':
      return inputs.some((input) => input === 1) ? 1 : 0;
    case 'notGate':
      return inputs[0] === 0 ? 1 : 0;
    case 'nandGate':
      return inputs.every((input) => input === 1) ? 0 : 1;
    case 'norGate':
      return inputs.some((input) => input === 1) ? 0 : 1;
    case 'xorGate':
      return inputs[0] !== inputs[1] ? 1 : 0;
    case 'xnorGate':
      return inputs[0] === inputs[1] ? 1 : 0;
    default:
      return 0;
  }
};

/** Signature of the circuit simulation function returned by the hook. */
export type SimulateCircuit = (
  currentNodes: DigiNode[],
  currentEdges: DigiEdge[]
) => DigiNode[];

/**
 * Hook that exposes simulateCircuit — call it with current nodes and edges to get
 * back a new nodes array with updated data.value on every node.
 *
 * @returns The simulateCircuit function
 */
export const useLogicSimulation = (): { simulateCircuit: SimulateCircuit } => {
  /**
   * Run a full topological evaluation of the circuit using Kahn's algorithm.
   * Nodes in cycles are skipped and default to value 0.
   *
   * @param currentNodes - ReactFlow node array (read-only — returns a new array)
   * @param currentEdges - ReactFlow edge array
   * @returns New node array with updated data.value fields
   */
  const simulateCircuit = useCallback<SimulateCircuit>((currentNodes, currentEdges) => {
    const newNodes: DigiNode[] = currentNodes.map((node) => ({
      ...node,
      data: { ...node.data },
    }));
    const nodeMap = new Map<string, DigiNode>(newNodes.map((node) => [node.id, node]));

    // Build adjacency list: sourceId → [targetId, ...]
    const successors = new Map<string, string[]>(newNodes.map((n) => [n.id, []]));
    // Build in-degree count per node
    const inDegree = new Map<string, number>(newNodes.map((n) => [n.id, 0]));

    for (const edge of currentEdges) {
      if (successors.has(edge.source) && inDegree.has(edge.target)) {
        successors.get(edge.source)!.push(edge.target);
        inDegree.set(edge.target, inDegree.get(edge.target)! + 1);
      }
    }

    // Seed queue with all zero-in-degree nodes; input nodes go first
    const queue: string[] = [];
    for (const node of newNodes) {
      if (inDegree.get(node.id) === 0) {
        if (node.type === 'input') {
          queue.unshift(node.id);
        } else {
          queue.push(node.id);
        }
      }
    }

    // Kahn's BFS — process each node once its all inputs are resolved
    while (queue.length > 0) {
      const id = queue.shift()!;
      const node = nodeMap.get(id);
      if (!node) continue;

      if (node.type !== 'input') {
        const incomingEdges = currentEdges.filter((edge) => edge.target === id);
        const inputs = incomingEdges.map((edge) => {
          const src = nodeMap.get(edge.source);
          return src && src.data.value !== undefined ? src.data.value : 0;
        });

        if (node.type === 'output') {
          node.data.value = inputs.length > 0 ? inputs[0] : 0;
        } else {
          node.data.value = evaluateGate(node.type, inputs);
        }
      }

      // Decrement in-degree of successors; enqueue those that reach 0
      for (const successorId of successors.get(id) ?? []) {
        const newDegree = inDegree.get(successorId)! - 1;
        inDegree.set(successorId, newDegree);
        if (newDegree === 0) {
          queue.push(successorId);
        }
      }
    }

    // Nodes never dequeued (cycle members) keep their current value (defaults to 0)
    return newNodes;
  }, []);

  return { simulateCircuit };
};
