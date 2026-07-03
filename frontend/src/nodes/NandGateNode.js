/**
 * @file NandGateNode.js
 * @description ReactFlow custom node for a NAND logic gate — renders the ANSI
 * schematic symbol via GateShell with 2 input handles and one output handle.
 */

import React from 'react';
import GateShell from './GateShell';

/**
 * NAND gate node component for the DigiSim canvas.
 * @param {{ data: { label: string, value: number } }} props - Node data from ReactFlow
 * @returns {React.ReactElement} Rendered NAND gate node
 */
function NandGateNode({ data }) {
  return <GateShell type="nand" data={data} inputs={2} />;
}

export default NandGateNode;
