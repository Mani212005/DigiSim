/**
 * @file AndGateNode.tsx
 * @description ReactFlow custom node for an AND logic gate — renders the ANSI
 * schematic symbol via GateShell with 2 input handles and one output handle.
 */

import React from 'react';
import GateShell from './GateShell';
import type { GateNodeProps } from '../types';

/**
 * AND gate node component for the DigiSim canvas.
 * @param props - Node data from ReactFlow
 * @returns Rendered AND gate node
 */
function AndGateNode({ data }: GateNodeProps): React.ReactElement {
  return <GateShell type="and" data={data} inputs={2} />;
}

export default AndGateNode;
