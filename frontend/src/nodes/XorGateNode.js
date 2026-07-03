/**
 * @file XorGateNode.js
 * @description ReactFlow custom node for an XOR logic gate — renders the ANSI
 * schematic symbol via GateShell with 2 input handles and one output handle.
 */

import React from 'react';
import GateShell from './GateShell';

/**
 * XOR gate node component for the DigiSim canvas.
 * @param {{ data: { label: string, value: number } }} props - Node data from ReactFlow
 * @returns {React.ReactElement} Rendered XOR gate node
 */
function XorGateNode({ data }) {
  return <GateShell type="xor" data={data} inputs={2} />;
}

export default XorGateNode;
