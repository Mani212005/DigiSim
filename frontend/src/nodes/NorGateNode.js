/**
 * @file NorGateNode.js
 * @description ReactFlow custom node for a NOR logic gate — renders the ANSI
 * schematic symbol via GateShell with 2 input handles and one output handle.
 */

import React from 'react';
import GateShell from './GateShell';

/**
 * NOR gate node component for the DigiSim canvas.
 * @param {{ data: { label: string, value: number } }} props - Node data from ReactFlow
 * @returns {React.ReactElement} Rendered NOR gate node
 */
function NorGateNode({ data }) {
  return <GateShell type="nor" data={data} inputs={2} />;
}

export default NorGateNode;
