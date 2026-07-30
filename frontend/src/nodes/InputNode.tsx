/**
 * @file InputNode.tsx
 * @description ReactFlow custom node for a circuit input — a toggle switch the user
 * clicks to flip between logic 0 and 1. Glows when driving a HIGH signal.
 */

import React from 'react';
import { Handle, Position } from 'reactflow';
import type { InputNodeProps } from '../types';

/**
 * Clickable toggle-switch input node that flips its value between 0 and 1.
 * @param props - Node id, data, and the shared updateNodeData callback
 * @returns Rendered input node
 */
function InputNode({ data, id, updateNodeData }: InputNodeProps): React.ReactElement {
  const active = data.value === 1;

  /** Toggle the input value between 0 and 1 and propagate via updateNodeData. */
  const toggleInput = (): void => {
    updateNodeData(id, { value: active ? 0 : 1 });
  };

  return (
    <div
      className={`node-card glass node-input${active ? ' active' : ''}`}
      onClick={toggleInput}
      role="switch"
      aria-checked={active}
      aria-label={`${data.label} toggle`}
    >
      <div className="node-header">{data.label}</div>
      <div className="node-body">
        <div className="switch-toggle" />
      </div>
      <Handle type="source" position={Position.Right} className="handle handle-right" />
    </div>
  );
}

export default InputNode;
