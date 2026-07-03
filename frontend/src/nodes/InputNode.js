/**
 * @file InputNode.js
 * @description ReactFlow custom node for a circuit input — a toggle switch the user
 * clicks to flip between logic 0 and 1. Glows when driving a HIGH signal.
 */

import React from 'react';
import { Handle, Position } from 'reactflow';

/**
 * Clickable toggle-switch input node that flips its value between 0 and 1.
 * @param {{ data: { label: string, value: number }, id: string, updateNodeData: Function }} props
 * @returns {React.ReactElement} Rendered input node
 */
function InputNode({ data, id, updateNodeData }) {
  const active = data.value === 1;

  /**
   * Toggle the input value between 0 and 1 and propagate via updateNodeData.
   */
  const toggleInput = () => {
    updateNodeData(id, { value: active ? 0 : 1 });
  };

  return (
    <div
      className={`io-node input-node${active ? ' io-node--on' : ''}`}
      onClick={toggleInput}
      role="switch"
      aria-checked={active}
      aria-label={`${data.label} toggle`}
    >
      <span className="io-node__label">{data.label}</span>
      <div className="toggle-track">
        <div className="toggle-thumb">{data.value}</div>
      </div>
      <span className="io-node__state">{active ? 'HIGH' : 'LOW'}</span>
      <Handle type="source" position={Position.Right} style={{ top: '50%' }} />
    </div>
  );
}

export default InputNode;
