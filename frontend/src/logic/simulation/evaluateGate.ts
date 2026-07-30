/**
 * @file evaluateGate.ts
 * @description Single dispatch point for all digital gate logic in DigiSim.
 * Supports standard gates, Tristate, Multiplexers, Flip-Flops, handling Z/X states.
 */

export const evaluateGate = (type: string | undefined, inputs: (number | string)[], oldVal: number | string = 0): number | string => {
  if (inputs.length === 0 && type !== 'clock') return 'Z';

  // Helper to convert inputs. Treats 'Z'/'X' explicitly if needed, but defaults to 'X' in strict digital math.
  const hasZ = inputs.includes('Z');
  const hasX = inputs.includes('X');
  
  if (hasX) return 'X';

  const num = (v: number | string): number => (v === 1 || v === '1' ? 1 : 0);

  switch (type) {
    case 'andGate':
      if (inputs.some(i => i === 0)) return 0;
      if (hasZ) return 'X';
      return 1;
      
    case 'orGate':
      if (inputs.some(i => i === 1)) return 1;
      if (hasZ) return 'X';
      return 0;
      
    case 'notGate':
      if (hasZ) return 'X';
      return num(inputs[0]) === 0 ? 1 : 0;
      
    case 'nandGate':
      if (inputs.some(i => i === 0)) return 1;
      if (hasZ) return 'X';
      return 0;
      
    case 'norGate':
      if (inputs.some(i => i === 1)) return 0;
      if (hasZ) return 'X';
      return 1;
      
    case 'xorGate': {
      if (hasZ) return 'X';
      const ones = inputs.filter(i => num(i) === 1).length;
      return ones % 2 === 1 ? 1 : 0;
    }
      
    case 'xnorGate': {
      if (hasZ) return 'X';
      const onesXnor = inputs.filter(i => num(i) === 1).length;
      return onesXnor % 2 === 1 ? 0 : 1;
    }

    case 'tristate': {
      // inputs[0] = data, inputs[1] = enable
      if (inputs.length < 2) return 'Z';
      if (num(inputs[1]) === 1) return inputs[0];
      return 'Z';
    }

    case 'mux': {
      // inputs[0] = sel, inputs[1] = data0, inputs[2] = data1
      if (hasZ) return 'X';
      const sel = num(inputs[0]);
      return sel === 0 ? inputs[1] : inputs[2];
    }

    case 'dFlipFlop': {
      // inputs[0] = D, inputs[1] = CLK
      // This is a naive D flip-flop using the fact that runSimulation evaluates iteratively.
      // A true edge-triggered DFF in iterative eval needs state. Since we don't have separate state memory,
      // we just act as a transparent latch when CLK=1 for simplicity, or we require full state nodes.
      // Actually, since this is a pure function and we only have oldVal, we can latch when CLK=0.
      if (num(inputs[1]) === 1) return inputs[0];
      return oldVal;
    }
      
    default:
      return 'X';
  }
};
