/**
 * @file useLogicSimulation.ts
 * @description Thin React hook over the simulation engine. All simulation
 * logic (digital gate evaluation and the analog MNA solver) lives in
 * src/logic/simulation/ (CLAUDE.md); this file only adapts it to a stable
 * hook-shaped API for App.tsx.
 */

import { useCallback } from 'react';
import { simulate } from '../logic/simulation';
import type { SimulateCircuit } from '../logic/simulation';

export type { SimulateCircuit } from '../logic/simulation';

/**
 * Hook that exposes simulateCircuit — call it with current nodes and edges to
 * get back a new nodes array with updated simulation outputs on every node.
 *
 * @returns The simulateCircuit function
 */
export const useLogicSimulation = (): { simulateCircuit: SimulateCircuit } => {
  const simulateCircuit = useCallback<SimulateCircuit>(
    (currentNodes, currentEdges) => simulate(currentNodes, currentEdges),
    []
  );

  return { simulateCircuit };
};
