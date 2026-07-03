/**
 * @file OrGateNode.js
 * @description ReactFlow custom node for an OR logic gate — renders the ANSI
 * schematic symbol via GateShell with 2 input handles and one output handle.
 */

import React from 'react';
import GateShell from './GateShell';

/**
 * OR gate node component for the DigiSim canvas.
 * @param {{ data: { label: string, value: number } }} props - Node data from ReactFlow
 * @returns {React.ReactElement} Rendered OR gate node
 */
function OrGateNode({ data }) {
  return <GateShell type="or" data={data} inputs={2} />;
}

export default OrGateNode;
