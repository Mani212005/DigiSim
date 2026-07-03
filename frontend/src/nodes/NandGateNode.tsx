/**
 * @file NandGateNode.tsx
 * @description ReactFlow custom node for a NAND logic gate — renders the ANSI
 * schematic symbol via GateShell with 2 input handles and one output handle.
 */

import React from 'react';
import GateShell from './GateShell';
import type { GateNodeProps } from '../types';

/**
 * NAND gate node component for the DigiSim canvas.
 * @param props - Node data from ReactFlow
 * @returns Rendered NAND gate node
 */
function NandGateNode({ data }: GateNodeProps): React.ReactElement {
  return <GateShell type="nand" data={data} inputs={2} />;
}

export default NandGateNode;
