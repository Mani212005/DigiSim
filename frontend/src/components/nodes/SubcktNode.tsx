/**
 * @file SubcktNode.tsx
 * @description Sub-circuit block component for OpenAccess Cell Hierarchy in DigiSim.
 * Supports dynamic port handle rendering, instance parameter pass-through (PARAMS),
 * and push-pop canvas drill-down navigation.
 */

import React from 'react';
import { Handle, Position } from 'reactflow';
import { CellRegistry } from '../../logic/hierarchy/CellRegistry';
import type { AnalogNodeProps, PortDirection, PortSide } from '../../types';
import './MosfetNode.css';

const POSITION_BY_PORT_SIDE: Record<PortSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

const DEFAULT_SIDE_BY_DIRECTION: Record<PortDirection, Position> = {
  in: Position.Left,
  out: Position.Right,
  inout: Position.Top,
};

export interface SubcktNodeProps extends AnalogNodeProps {
  onDrillDown?: (cellName: string, params: Record<string, number | string>) => void;
}

export function SubcktNode({ id, data, updateNodeData, onDrillDown }: SubcktNodeProps): React.ReactElement {
  const cellName = data.cellName || 'INVERTER';
  const cellDef = CellRegistry.getCell(cellName);

  const instanceParams: Record<string, number | string> = data.params ?? {
    ...(cellDef?.parameters ?? { W_p: 2.4, W_n: 1.2, L: 0.18 }),
  };

  const ports = cellDef?.ports ?? [
    { name: 'in', direction: 'in', side: 'left' },
    { name: 'out', direction: 'out', side: 'right' },
  ];

  const handleParamChange = (paramKey: string, rawVal: string) => {
    const num = Number(rawVal);
    const newVal = isNaN(num) ? rawVal : num;
    const updated = { ...instanceParams, [paramKey]: newVal };
    updateNodeData(id, { params: updated });
  };

  const handleDrillDownClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDrillDown) {
      onDrillDown(cellName, instanceParams);
    } else {
      // Dispatch a custom event if prop isn't directly passed
      const event = new CustomEvent('digisim:drilldown', {
        detail: { cellName, params: instanceParams, nodeId: id },
        bubbles: true,
      });
      window.dispatchEvent(event);
    }
  };

  return (
    <div className="subckt-node" onDoubleClick={handleDrillDownClick}>
      {/* Dynamic Port Handles */}
      {ports.map((port) => {
        const pos = port.side ? POSITION_BY_PORT_SIDE[port.side] : DEFAULT_SIDE_BY_DIRECTION[port.direction];
        const isTarget = port.direction === 'in' || port.direction === 'inout';
        const isSource = port.direction === 'out' || port.direction === 'inout';

        return (
          <React.Fragment key={port.name}>
            {isTarget && (
              <Handle type="target" id={`t:${port.name}`} position={pos} className="analog-pin" />
            )}
            {isSource && (
              <Handle type="source" id={`s:${port.name}`} position={pos} className="analog-pin" />
            )}
          </React.Fragment>
        );
      })}

      <div className="subckt-header">
        <span className="subckt-title">{data.label || cellName}</span>
        <span className="subckt-cellname">:{cellName}</span>
      </div>

      {/* Parameter Pass-Through Editor */}
      <div className="subckt-params nodrag">
        <div className="subckt-params-title">PARAMS</div>
        {Object.entries(instanceParams).map(([key, val]) => (
          <div key={key} className="subckt-param-row">
            <span className="subckt-param-key">{key}=</span>
            <input
              type="text"
              value={String(val)}
              onChange={(e) => handleParamChange(key, e.target.value)}
              className="subckt-param-input"
            />
          </div>
        ))}
      </div>

      {/* Push / Drill-Down Action Button */}
      <div className="subckt-actions nodrag">
        <button
          className="subckt-btn-drill"
          onClick={handleDrillDownClick}
          title="Drill down into sub-circuit schematic"
        >
          🔍 Push / Drill Down
        </button>
      </div>
    </div>
  );
}

export default SubcktNode;
