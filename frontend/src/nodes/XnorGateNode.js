/**
 * @file XnorGateNode.js
 * @description ReactFlow custom node for an XNOR logic gate — renders the ANSI
 * schematic symbol via GateShell with 2 input handles and one output handle.
 */

import React from 'react';
import GateShell from './GateShell';

/**
 * XNOR gate node component for the DigiSim canvas.
 * @param {{ data: { label: string, value: number } }} props - Node data from ReactFlow
 * @returns {React.ReactElement} Rendered XNOR gate node
 */
function XnorGateNode({ data }) {
  return <GateShell type="xnor" data={data} inputs={2} />;
}

export default XnorGateNode;
