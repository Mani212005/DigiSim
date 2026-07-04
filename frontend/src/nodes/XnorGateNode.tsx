/**
 * @file XnorGateNode.tsx
 * @description ReactFlow custom node for an XNOR logic gate — renders the ANSI
 * schematic symbol via GateShell with 2 input handles and one output handle.
 */

import React from 'react';
import GateShell from './GateShell';
import type { GateNodeProps } from '../types';

/**
 * XNOR gate node component for the DigiSim canvas.
 * @param props - Node data from ReactFlow
 * @returns Rendered XNOR gate node
 */
function XnorGateNode({ data }: GateNodeProps): React.ReactElement {
  return <GateShell type="xnor" data={data} inputs={2} />;
}

export default XnorGateNode;
