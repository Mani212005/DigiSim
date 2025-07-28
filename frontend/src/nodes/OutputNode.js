import React from 'react';
import { Handle, Position } from 'reactflow';

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