/**
 * @file InspectorPanel.tsx
 * @description Dockable 320px glassmorphic HUD Inspector panel displaying component properties,
 * signal telemetry, hardware constraint warnings, and quick fix actions.
 */

import React, { useState } from 'react';
import type { DigiNode, UpdateNodeData } from '../types';
import './InspectorPanel.css';

export interface InspectorPanelProps {
  node: DigiNode;
  updateNodeData: UpdateNodeData;
  onDelete: () => void;
  onClose?: () => void;
  onInsertAdcBuffer?: (nodeId: string) => void;
}

/** Deterministic pin binding generator based on node ID hash */
const getPinBinding = (id: string, customPin?: string): string => {
  if (customPin) return customPin;
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  const pinNum = (Math.abs(hash) % 16) + 1;
  return `GPIO ${pinNum}`;
};

const InspectorPanel: React.FC<InspectorPanelProps> = ({
  node,
  updateNodeData,
  onDelete,
  onClose,
  onInsertAdcBuffer,
}) => {
  const [isDocked, setIsDocked] = useState(true);
  const [bufferInsertedState, setBufferInsertedState] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateNodeData(node.id, { label: e.target.value });
  };

  const handleParamChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      updateNodeData(node.id, { param: val });
    }
  };

  const handlePercentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      updateNodeData(node.id, { percent: val });
    }
  };

  const isAnalog =
    node.type === 'analog' ||
    node.type === 'vsource' ||
    node.type === 'resistor' ||
    node.type === 'potentiometer';

  const handleAutoInsertAdc = () => {
    setBufferInsertedState(true);
    updateNodeData(node.id, { hasAdcBuffer: true });
    if (onInsertAdcBuffer) {
      onInsertAdcBuffer(node.id);
    }
  };

  const isBufferInserted = bufferInsertedState || Boolean(node.data?.hasAdcBuffer);

  const getLiveVoltage = () => {
    if (node.data?.value === 1) return '5.00V Logic HIGH';
    if (node.data?.value === 0) return '0.00V Logic LOW';
    if (typeof node.data?.param === 'number') {
      const v = node.data.param;
      const state = v >= 2.0 ? 'Logic HIGH' : 'Logic LOW';
      return `${v.toFixed(2)}V ${state}`;
    }
    return '2.48V Logic HIGH';
  };

  const pinBinding = getPinBinding(node.id, node.data?.pin);

  return (
    <aside className={`inspector-hud glass${isDocked ? ' docked' : ''}`} aria-label="HUD Inspector">
      <div className="inspector-header">
        <div className="header-title-group">
          <span className="hud-status-dot" />
          <h3>{node.data?.label || (node.type ? node.type.toUpperCase() : 'UNKNOWN')}</h3>
        </div>
        <div className="header-actions">
          <button
            className="btn-icon"
            onClick={() => setIsDocked(!isDocked)}
            title={isDocked ? 'Undock HUD' : 'Dock HUD'}
          >
            {isDocked ? '⏏' : '📌'}
          </button>
          {onClose && (
            <button className="btn-icon btn-close" onClick={onClose} title="Close Inspector">
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="inspector-body">
        <div className="inspector-section telemetry-section">
          <div className="info-row">
            <span className="info-label">Signal Type</span>
            <span className="info-value signal-type-badge">{isAnalog ? 'Analog' : 'Digital CMOS'}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Live Voltage</span>
            <span className="info-value highlight">{getLiveVoltage()}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Pin Binding</span>
            <span className="info-value font-mono">{pinBinding}</span>
          </div>
        </div>

        <div className="inspector-section config-section">
          <div className="form-group">
            <label htmlFor="node-label-input">Label</label>
            <input
              id="node-label-input"
              type="text"
              value={node.data?.label || ''}
              onChange={handleChange}
              placeholder="Component Label"
            />
          </div>

          {node.type === 'vsource' && (
            <div className="form-group">
              <label htmlFor="node-voltage-input">Voltage (V)</label>
              <input
                id="node-voltage-input"
                type="number"
                step="0.1"
                value={node.data?.param ?? 5}
                onChange={handleParamChange}
              />
            </div>
          )}

          {(node.type === 'resistor' || node.type === 'potentiometer') && (
            <div className="form-group">
              <label htmlFor="node-res-input">Resistance (Ω)</label>
              <input
                id="node-res-input"
                type="number"
                step="10"
                value={node.data?.param ?? (node.type === 'resistor' ? 220 : 10000)}
                onChange={handleParamChange}
              />
            </div>
          )}

          {node.type === 'potentiometer' && (
            <div className="form-group">
              <label htmlFor="node-wiper-input">Wiper Position (%)</label>
              <input
                id="node-wiper-input"
                type="number"
                step="1"
                min="0"
                max="100"
                value={node.data?.percent ?? 50}
                onChange={handlePercentChange}
              />
            </div>
          )}
        </div>

        {isAnalog && (
          <div className={`warning-box ${isBufferInserted ? 'warning-resolved' : ''}`}>
            <div className="warning-header">
              <span className="warning-icon">{isBufferInserted ? '✅' : '⚠️'}</span>
              <span className="warning-title">Hardware Constraint</span>
            </div>
            <p>
              {isBufferInserted
                ? 'ADC Buffer inserted. Signal correctly conditioned for CMOS gates.'
                : 'Analog signals cannot directly drive pure CMOS gates without an ADC buffer.'}
            </p>
            <button
              className={`btn btn-action ${isBufferInserted ? 'btn-action-inserted' : ''}`}
              onClick={handleAutoInsertAdc}
              disabled={isBufferInserted}
            >
              {isBufferInserted ? '✓ ADC Buffer Inserted' : '✓ Auto-Insert ADC Buffer'}
            </button>
          </div>
        )}
      </div>

      <div className="inspector-footer">
        <button className="btn btn-danger" onClick={onDelete}>
          Delete Node
        </button>
      </div>
    </aside>
  );
};

export default InspectorPanel;

