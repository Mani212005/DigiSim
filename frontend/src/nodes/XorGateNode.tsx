/**
 * @file XorGateNode.tsx
 * @description ReactFlow custom node for an XOR logic gate — renders the ANSI
 * schematic symbol via GateShell with 2 input handles and one output handle.
 */

import React from 'react';
import GateShell from './GateShell';
import type { GateNodeProps } from '../types';

/**
 * XOR gate node component for the DigiSim canvas.
 * @param props - Node data from ReactFlow
 * @returns Rendered XOR gate node
 */
function XorGateNode({ data }: GateNodeProps): React.ReactElement {
  return <GateShell type="xor" data={data} inputs={2} />;
}

export default XorGateNode;
