/**
 * @file NorGateNode.tsx
 * @description ReactFlow custom node for a NOR logic gate — renders the ANSI
 * schematic symbol via GateShell with 2 input handles and one output handle.
 */

import React from 'react';
import GateShell from './GateShell';
import type { GateNodeProps } from '../types';

/**
 * NOR gate node component for the DigiSim canvas.
 * @param props - Node data from ReactFlow
 * @returns Rendered NOR gate node
 */
function NorGateNode({ data }: GateNodeProps): React.ReactElement {
  return <GateShell type="nor" data={data} inputs={2} />;
}

export default NorGateNode;
