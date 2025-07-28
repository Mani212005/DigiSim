import React from 'react';
import { Handle, Position } from 'reactflow';

function InputNode({ data, id, updateNodeData }) {
  const toggleInput = () => {
    const newValue = data.value === 0 ? 1 : 0;
    updateNodeData(id, { value: newValue });
  };

  return (
    <div
      style={{
        padding: 10,
        border: '1px solid #ccc',
        borderRadius: 5,
        background: data.value === 1 ? 'yellow' : '#ffaaaa',
        textAlign: 'center',
        cursor: 'pointer',
      }}
      onClick={toggleInput}
    >
      <div>{data.label}</div>
      <div>Value: {data.value}</div>
      <Handle type="source" position={Position.Right} style={{ top: '50%' }} />
    </div>
  );
}

export default InputNode;