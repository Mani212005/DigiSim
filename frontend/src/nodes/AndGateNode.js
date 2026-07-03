/**
 * @file AndGateNode.js
 * @description ReactFlow custom node for an AND logic gate — renders the ANSI
 * schematic symbol via GateShell with 2 input handles and one output handle.
 */

import React from 'react';
import GateShell from './GateShell';

/**
 * AND gate node component for the DigiSim canvas.
 * @param {{ data: { label: string, value: number } }} props - Node data from ReactFlow
 * @returns {React.ReactElement} Rendered AND gate node
 */
function AndGateNode({ data }) {
  return <GateShell type="and" data={data} inputs={2} />;
}

export default AndGateNode;
