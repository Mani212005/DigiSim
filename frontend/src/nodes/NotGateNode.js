/**
 * @file NotGateNode.js
 * @description ReactFlow custom node for a NOT logic gate — renders the ANSI
 * schematic symbol via GateShell with 1 input handle and one output handle.
 */

import React from 'react';
import GateShell from './GateShell';

/**
 * NOT gate node component for the DigiSim canvas.
 * @param {{ data: { label: string, value: number } }} props - Node data from ReactFlow
 * @returns {React.ReactElement} Rendered NOT gate node
 */
function NotGateNode({ data }) {
  return <GateShell type="not" data={data} inputs={1} />;
}

export default NotGateNode;
