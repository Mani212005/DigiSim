/**
 * @file OutputNode.tsx
 * @description ReactFlow custom node for a circuit output — an LED indicator that
 * lights up when the computed signal is logic 1.
 */

import React from 'react';
import { Handle, Position } from 'reactflow';
import type { OutputNodeProps } from '../types';

/**
 * Output node rendering an LED that reflects the simulated value.
 * @param props - Node data from ReactFlow
 * @returns Rendered output node
 */
function OutputNode({ data }: OutputNodeProps): React.ReactElement {
  const active = data.value === 1;
  return (
    <div className={`node-card glass node-output${active ? ' active' : ''}`}>
      <div className="node-header">{data.label}</div>
      <div className="node-body">
        <div className="led-indicator" aria-label={`LED ${active ? 'on' : 'off'}`} />
      </div>
      <Handle type="target" position={Position.Left} className="handle handle-left" />
    </div>
  );
}

export default OutputNode;
