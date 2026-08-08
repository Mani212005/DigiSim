/**
 * @file InspectorPanel.tsx
 * @description Dockable HUD Inspector panel showing node properties, hardware constraints, and actions.
 */

import React from 'react';
import type { DigiNode, UpdateNodeData } from '../types';
import './InspectorPanel.css';

export interface InspectorPanelProps {
  node: DigiNode;
  updateNodeData: UpdateNodeData;
  onDelete: () => void;
}

const InspectorPanel: React.FC<InspectorPanelProps> = ({ node, updateNodeData, onDelete }) => {
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

  const isAnalog = node.type === 'analog' || node.type === 'vsource' || node.type === 'resistor' || node.type === 'potentiometer';

  return (
    <div className="inspector-hud glass">
      <div className="inspector-header">
        <h3>{node.data.label || (node.type ? node.type.toUpperCase() : 'UNKNOWN')}</h3>
        <button className="btn-close" onClick={() => {}} title="Dock/Undock">
          ⏏
        </button>
      </div>

      <div className="inspector-body">
        <div className="inspector-section">
          <div className="info-row">
            <span className="info-label">Signal Type</span>
            <span className="info-value">{isAnalog ? 'Analog' : 'Digital CMOS'}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Live Voltage</span>
            <span className="info-value highlight">{node.data.value === 1 ? '5.00V Logic HIGH' : (node.data.value === 0 ? '0.00V Logic LOW' : '2.48V Logic HIGH')}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Pin Binding</span>
            <span className="info-value">GPIO {Math.floor(Math.random() * 10) + 2}</span>
          </div>
        </div>

        <div className="inspector-section">
          <div className="form-group">
            <label>Label</label>
            <input type="text" value={node.data.label || ''} onChange={handleChange} />
          </div>
          
          {node.type === 'vsource' && (
            <div className="form-group">
              <label>Voltage (V)</label>
              <input type="number" step="0.1" value={node.data.param ?? 5} onChange={handleParamChange} />
            </div>
          )}
          
          {(node.type === 'resistor' || node.type === 'potentiometer') && (
            <div className="form-group">
              <label>Resistance (Ω)</label>
              <input type="number" step="10" value={node.data.param ?? (node.type === 'resistor' ? 220 : 10000)} onChange={handleParamChange} />
            </div>
          )}

          {node.type === 'potentiometer' && (
            <div className="form-group">
              <label>Wiper Position (%)</label>
              <input type="number" step="1" min="0" max="100" value={node.data.percent ?? 50} onChange={handlePercentChange} />
            </div>
          )}
        </div>

        {isAnalog && (
          <div className="warning-box">
            <span className="warning-icon">⚠️</span>
            <p>Analog signals cannot directly drive pure CMOS gates without an ADC buffer.</p>
            <button className="btn btn-action" onClick={() => {}}>✓ Auto-Insert ADC Buffer</button>
          </div>
        )}

      </div>
      
      <div className="inspector-footer">
        <button className="btn btn-danger" onClick={onDelete}>
          Delete Node
        </button>
      </div>
    </div>
  );
};

export default InspectorPanel;
