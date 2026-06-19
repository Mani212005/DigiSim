/**
 * @file OrGateNode.js
 * @description ReactFlow custom node for an OR logic gate — renders two inputs and one output handle.
 */

import React from 'react';
import { Handle, Position } from 'reactflow';

/**
 * OR gate node component for the DigiSim canvas.
 * @param {{ data: { label: string, value: number } }} props - Node data from ReactFlow
 * @returns {React.ReactElement} Rendered OR gate node
 */
function OrGateNode({ data }) {
  return (
    <div style={{
      padding: 10,
      border: '1px solid #ccc',
      borderRadius: 5,
      background: data.value === 1 ? 'yellow' : '#ffaaaa',
      textAlign: 'center',
    }}>
      <Handle type="target" position={Position.Left} id="a" style={{ top: '25%' }} />
      <Handle type="target" position={Position.Left} id="b" style={{ top: '75%' }} />
      <div>{data.label}</div>
      <Handle type="source" position={Position.Right} style={{ top: '50%' }} />
    </div>
  );
}

export default OrGateNode;