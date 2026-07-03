/**
 * @file OutputNode.js
 * @description ReactFlow custom node for a circuit output — an LED indicator that
 * lights up when the computed signal is logic 1.
 */

import React from 'react';
import { Handle, Position } from 'reactflow';

/**
 * Output node rendering an LED that reflects the simulated value.
 * @param {{ data: { label: string, value: number } }} props - Node data from ReactFlow
 * @returns {React.ReactElement} Rendered output node
 */
function OutputNode({ data }) {
  const active = data.value === 1;
  return (
    <div className={`io-node output-node${active ? ' io-node--on' : ''}`}>
      <Handle type="target" position={Position.Left} style={{ top: '50%' }} />
      <div className="led" aria-label={`LED ${active ? 'on' : 'off'}`} />
      <span className="io-node__label">{data.label}</span>
      <span className="io-node__state">{active ? 'HIGH' : 'LOW'}</span>
    </div>
  );
}

export default OutputNode;
