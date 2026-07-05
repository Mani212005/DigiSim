/**
 * @file index.ts
 * @description Simulation engine entry point (CLAUDE.md: all simulation logic
 * lives in src/logic/simulation/). simulate() partitions the canvas into
 * islands, keeps today's digital semantics for gate/IO islands, and solves
 * fully-analog islands with the MNA DC solver. Islands mixing gates with
 * analog parts simulate digitally and flag the analog parts — bridging the
 * two domains arrives with board pin stubs (S3).
 */

import type { DigiEdge, DigiNode } from '../../types';
import { runSimulation } from './digital';
import { ANALOG_TYPES, partitionIslands } from './islands';
import { solveAnalogIsland } from './mna';

export { evaluateGate } from './evaluateGate';
export { runSimulation } from './digital';
export type { SimulateCircuit } from './digital';
export { ANALOG_TYPES, partitionIslands } from './islands';
export { solveAnalogIsland } from './mna';

const MIXED_ISLAND_WARNING =
  'Analog parts can’t drive gates yet — connect them via board pins (coming in S3)';

/**
 * Simulate the whole canvas: digital islands via topological gate evaluation,
 * fully-analog islands via the MNA DC solver.
 *
 * @param nodes - ReactFlow node array (read-only — returns a new array)
 * @param edges - ReactFlow edge array
 * @returns New node array with updated simulation outputs in data
 */
export function simulate(nodes: DigiNode[], edges: DigiEdge[]): DigiNode[] {
  // Digital pass first — identical semantics to the pre-S1 engine, so pure
  // gate circuits behave exactly as before (analog types evaluate to 0 there).
  const result = runSimulation(nodes, edges);
  const byId = new Map(result.map((node) => [node.id, node]));

  // Reset analog outputs so parts unplugged from a source read zero again.
  for (const node of result) {
    if (ANALOG_TYPES.has(node.type ?? '')) {
      node.data.current = 0;
      node.data.voltageDrop = 0;
      if (node.type === 'led') node.data.brightness = 0;
      delete node.data.simWarning;
    }
  }

  for (const island of partitionIslands(nodes, edges)) {
    if (island.kind === 'analog') {
      const solved = solveAnalogIsland(island.nodes, island.edges);
      solved.forEach((outputs, nodeId) => {
        const node = byId.get(nodeId);
        if (!node) return;
        node.data.current = outputs.current;
        node.data.voltageDrop = outputs.voltageDrop;
        if (outputs.brightness !== undefined) node.data.brightness = outputs.brightness;
        if (outputs.simWarning) node.data.simWarning = outputs.simWarning;
      });
    } else if (island.mixed) {
      for (const islandNode of island.nodes) {
        if (ANALOG_TYPES.has(islandNode.type ?? '')) {
          const node = byId.get(islandNode.id);
          if (node) node.data.simWarning = MIXED_ISLAND_WARNING;
        }
      }
    }
  }
  return result;
}
