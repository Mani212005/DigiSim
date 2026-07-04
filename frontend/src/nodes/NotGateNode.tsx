/**
 * @file NotGateNode.tsx
 * @description ReactFlow custom node for a NOT logic gate — renders the ANSI
 * schematic symbol via GateShell with 1 input handle and one output handle.
 */

import React from 'react';
import GateShell from './GateShell';
import type { GateNodeProps } from '../types';

/**
 * NOT gate node component for the DigiSim canvas.
 * @param props - Node data from ReactFlow
 * @returns Rendered NOT gate node
 */
function NotGateNode({ data }: GateNodeProps): React.ReactElement {
  return <GateShell type="not" data={data} inputs={1} />;
}

export default NotGateNode;
