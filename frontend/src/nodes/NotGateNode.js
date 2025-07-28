import React from 'react';
import { Handle, Position } from 'reactflow';

function NotGateNode({ data }) {
  return (
    <div style={{
      padding: 10,
      border: '1px solid #ccc',
      borderRadius: 5,
      background: data.value === 1 ? 'yellow' : '#ffaaaa',
      textAlign: 'center',
    }}>
      <Handle type="target" position={Position.Left} id="a" style={{ top: '50%' }} />
      <div>{data.label}</div>
      <Handle type="source" position={Position.Right} style={{ top: '50%' }} />
    </div>
  );
}

export default NotGateNode;