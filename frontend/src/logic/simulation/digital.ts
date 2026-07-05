/**
 * @file digital.ts
 * @description Digital circuit evaluation — Kahn's algorithm (BFS topological
 * sort) propagates 0/1 logic values gate-by-gate. Moved intact from
 * useLogicSimulation.ts during the S1 engine layering; gate semantics stay in
 * evaluateGate.ts.
 */

import type { DigiEdge, DigiNode } from '../../types';
import { evaluateGate } from './evaluateGate';

/** Signature of the circuit simulation function. */
export type SimulateCircuit = (
  currentNodes: DigiNode[],
  currentEdges: DigiEdge[]
) => DigiNode[];

/**
 * Run a full topological evaluation of the circuit using Kahn's algorithm.
 * Nodes in cycles are skipped and default to value 0. This is the single pure
 * digital evaluator — the sim loop and the circuit-analysis tools (truth
 * tables) both call it so gate logic never gets duplicated.
 *
 * @param currentNodes - ReactFlow node array (read-only — returns a new array)
 * @param currentEdges - ReactFlow edge array
 * @returns New node array with updated data.value fields
 */
export const runSimulation: SimulateCircuit = (currentNodes, currentEdges) => {
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
};
