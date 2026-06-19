/**
 * @file InputNode.js
 * @description ReactFlow custom node for a circuit input — click to toggle between 0 and 1.
 */

import React from 'react';
import { Handle, Position } from 'reactflow';

/**
 * Clickable input node that toggles its value between 0 and 1.
 * @param {{ data: { label: string, value: number }, id: string, updateNodeData: Function }} props
 * @returns {React.ReactElement} Rendered input node
 */
function InputNode({ data, id, updateNodeData }) {
  /**
   * Toggle the input value between 0 and 1 and propagate via updateNodeData.
   */
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