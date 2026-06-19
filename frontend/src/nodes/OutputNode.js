/**
 * @file OutputNode.js
 * @description ReactFlow custom node for a circuit output — displays the computed logic value.
 */

import React from 'react';
import { Handle, Position } from 'reactflow';

/**
 * Output node that displays the final computed value from the simulation.
 * @param {{ data: { label: string, value: number } }} props - Node data from ReactFlow
 * @returns {React.ReactElement} Rendered output node
 */
function OutputNode({ data }) {
  return (
    <div style={{
      padding: 10,
      border: '1px solid #ccc',
      borderRadius: 5,
      background: data.value === 1 ? 'yellow' : '#ffaaaa',
      textAlign: 'center',
    }}>
      <Handle type="target" position={Position.Left} style={{ top: '50%' }} />
      <div>{data.label}</div>
      <div>Value: {data.value}</div>
    </div>
  );
}

export default OutputNode;