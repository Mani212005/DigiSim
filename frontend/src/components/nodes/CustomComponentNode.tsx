/**
 * @file CustomComponentNode.tsx
 * @description ReactFlow node component for rendering custom subcircuit instances.
 */

import React from 'react';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import type { NodeData, CustomComponentDefinition } from '../../types/index';
import './CustomComponentNode.css';

export interface CustomComponentNodeProps extends NodeProps<NodeData> {
  // We can't easily pass customComponent definition via props unless we inject it or store it in context.
  // Actually, we can store it in localStorage or a Context.
  // For now, let's assume it's stored in localStorage or a global registry.
}

const getPosition = (side: string): Position => {
  switch (side) {
    case 'LEFT': return Position.Left;
    case 'RIGHT': return Position.Right;
    case 'TOP': return Position.Top;
    case 'BOTTOM': return Position.Bottom;
    default: return Position.Left;
  }
};

export default function CustomComponentNode({ id, data }: CustomComponentNodeProps) {
  // In a real app we'd get this from a Context/Registry. For now, fetch from localStorage
  const registryStr = localStorage.getItem('customComponents') || '[]';
  const customComponents: CustomComponentDefinition[] = JSON.parse(registryStr);
  const def = customComponents.find(c => c.id === data.subcircuitRef);

  if (!def) {
    return (
      <div className="custom-component-node missing">
        <div>Missing Definition</div>
        <div>{data.label || 'Unknown'}</div>
      </div>
    );
  }

  return (
    <div className={`custom-component-node shape-${def.symbolShape?.toLowerCase() || 'rectangle'}`} onDoubleClick={(e) => {
      // Trigger drilldown
      e.stopPropagation();
      const event = new CustomEvent('digisim:drilldown_digital', {
        detail: { componentId: def.id, nodeId: id },
        bubbles: true,
      });
      window.dispatchEvent(event);
    }}>
      <div className="custom-component-header">
        <span className="custom-component-name">{def.name}</span>
      </div>

      {def.pins.map((pin) => {
        const pos = getPosition(pin.side);
        // Is it target or source?
        // INPUT -> target
        // OUTPUT -> source
        // BIDIRECTIONAL -> both?
        return (
          <React.Fragment key={pin.id}>
            {pin.type !== 'OUTPUT' && (
              <Handle
                type="target"
                id={`t:${pin.id}`}
                position={pos}
                className="custom-pin"
                style={{
                  ...((pin.side === 'LEFT' || pin.side === 'RIGHT') ? { top: '50%' } : { left: '50%' })
                }}
              />
            )}
            {pin.type !== 'INPUT' && (
              <Handle
                type="source"
                id={`s:${pin.id}`}
                position={pos}
                className="custom-pin"
                style={{
                  ...((pin.side === 'LEFT' || pin.side === 'RIGHT') ? { top: '50%' } : { left: '50%' })
                }}
              />
            )}
            {/* simple label */}
            <span className={`pin-label pin-label-${pin.side.toLowerCase()}`} data-id={pin.id}>
              {pin.label}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}
