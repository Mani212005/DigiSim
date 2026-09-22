/**
 * @file PackageSubcircuitModal.tsx
 * @description Modal to package selected nodes into a reusable hierarchical component.
 */

import React, { useState, useMemo } from 'react';
import type { DigiNode, DigiEdge, CustomComponentDefinition } from '../types';
import './PackageSubcircuitModal.css';

interface PackageSubcircuitModalProps {
  nodes: DigiNode[];
  edges: DigiEdge[];
  onClose: () => void;
  onSave: (def: CustomComponentDefinition) => void;
}

export function PackageSubcircuitModal({ nodes, edges, onClose, onSave }: PackageSubcircuitModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('User Library');
  const [symbolShape, setSymbolShape] = useState<'RECTANGLE' | 'DIP_CHIP'>('RECTANGLE');

  // Auto-detect inputs and outputs from selected nodes
  const detectedPins = useMemo(() => {
    const pins: CustomComponentDefinition['pins'] = [];
    nodes.forEach(node => {
      if (node.type === 'input') {
        pins.push({
          id: node.id,
          label: node.data.label || `IN_${node.id}`,
          type: 'INPUT',
          side: 'LEFT'
        });
      } else if (node.type === 'output') {
        pins.push({
          id: node.id,
          label: node.data.label || `OUT_${node.id}`,
          type: 'OUTPUT',
          side: 'RIGHT'
        });
      }
    });
    return pins;
  }, [nodes]);

  const [pins, setPins] = useState(detectedPins);

  const updatePin = (id: string, field: string, value: string) => {
    setPins(pins.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const handleSave = () => {
    if (!name.trim()) return alert('Name is required');
    
    const def: CustomComponentDefinition = {
      id: `custom_${Date.now()}`,
      name,
      description,
      category,
      pins,
      subcircuit: { nodes, edges },
      symbolShape,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    onSave(def);
  };

  return (
    <div className="modal-overlay">
      <div className="package-modal">
        <h2>Package Subcircuit</h2>
        
        <div className="package-form">
          <label>
            Name:
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 4-to-1 MUX" />
          </label>
          <label>
            Description:
            <input value={description} onChange={e => setDescription(e.target.value)} />
          </label>
          <label>
            Category:
            <input value={category} onChange={e => setCategory(e.target.value)} />
          </label>
          <label>
            Symbol Shape:
            <select value={symbolShape} onChange={e => setSymbolShape(e.target.value as 'RECTANGLE' | 'DIP_CHIP')}>
              <option value="RECTANGLE">Rectangle</option>
              <option value="DIP_CHIP">DIP Chip</option>
            </select>
          </label>
        </div>

        <div className="pins-config">
          <h3>Pin Configuration</h3>
          <table>
            <thead>
              <tr>
                <th>Internal Node</th>
                <th>Label</th>
                <th>Side</th>
              </tr>
            </thead>
            <tbody>
              {pins.map(pin => (
                <tr key={pin.id}>
                  <td>{pin.id} ({pin.type})</td>
                  <td>
                    <input value={pin.label} onChange={e => updatePin(pin.id, 'label', e.target.value)} />
                  </td>
                  <td>
                    <select value={pin.side} onChange={e => updatePin(pin.id, 'side', e.target.value)}>
                      <option value="LEFT">Left</option>
                      <option value="RIGHT">Right</option>
                      <option value="TOP">Top</option>
                      <option value="BOTTOM">Bottom</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="symbol-preview">
          <h3>Symbol Preview</h3>
          <div className={`preview-box shape-${symbolShape.toLowerCase()}`}>
            <div className="preview-name">{name || 'Component'}</div>
            {pins.map(pin => (
              <div key={pin.id} className={`preview-pin preview-pin-${pin.side.toLowerCase()}`}>
                {pin.label}
              </div>
            ))}
          </div>
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button onClick={handleSave} className="primary-btn">Save to Library</button>
        </div>
      </div>
    </div>
  );
}
