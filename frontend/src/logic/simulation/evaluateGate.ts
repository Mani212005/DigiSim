/**
 * @file evaluateGate.ts
 * @description Single dispatch point for all digital gate logic in DigiSim
 * (CLAUDE.md: simulation logic lives only in src/logic/simulation/). Moved
 * intact from useLogicSimulation.ts during the S1 engine layering.
 */

/**
 * Evaluate a single gate's output given its type and input values.
 * This is the single dispatch point for all gate logic in DigiSim.
 *
 * @param type - ReactFlow node type string (e.g. 'andGate', 'norGate')
 * @param inputs - Array of 0/1 input values from connected source nodes
 * @returns 0 or 1 output value
 */
export const evaluateGate = (type: string | undefined, inputs: number[]): number => {
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
