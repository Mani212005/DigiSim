/**
 * @file OrGateNode.tsx
 * @description ReactFlow custom node for an OR logic gate — renders the ANSI
 * schematic symbol via GateShell with 2 input handles and one output handle.
 */

import React from 'react';
import GateShell from './GateShell';
import type { GateNodeProps } from '../types';

/**
 * OR gate node component for the DigiSim canvas.
 * @param props - Node data from ReactFlow
 * @returns Rendered OR gate node
 */
function OrGateNode({ data }: GateNodeProps): React.ReactElement {
  return <GateShell type="or" data={data} inputs={2} />;
}

export default OrGateNode;
