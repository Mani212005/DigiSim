/**
 * @file InspectorPanel.tsx
 * @description Inspector panel showing properties for the selected node.
 */

import React from 'react';
import type { DigiNode, UpdateNodeData } from '../types';

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

  return (
    <div className="inspector glass">
      <h3>Properties</h3>
      <div className="form-group" style={{ marginTop: '1rem' }}>
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

      <button className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem', background: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={onDelete}>
        Delete Node
      </button>
    </div>
  );
};

export default InspectorPanel;
