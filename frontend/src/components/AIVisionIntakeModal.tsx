/**
 * @file AIVisionIntakeModal.tsx
 * @description Modal for AI-assisted circuit and pinout synthesis from photos.
 */

import React, { useState, useRef } from 'react';
import type { CustomComponentDefinition, DigiNode, DigiEdge } from '../types';
import './AIVisionIntakeModal.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

interface AIResult {
  componentName?: string;
  category?: string;
  confidence: number;
  unverifiedPins?: string[];
  pins: CustomComponentDefinition['pins'];
  subcircuit: { nodes: DigiNode[]; edges: DigiEdge[] };
}

interface Props {
  onClose: () => void;
  onSave: (def: CustomComponentDefinition) => void;
}

export function AIVisionIntakeModal({ onClose, onSave }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AIResult | null>(null);
  const [prompt, setPrompt] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const b64 = ev.target?.result as string;
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/circuit/photo-to-subcircuit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: b64, prompt })
        });
        if (!res.ok) throw new Error('API Error');
        const data = await res.json();
        setResult(data);
      } catch (err) {
        alert('Failed to synthesize circuit');
      } finally {
        setLoading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleApprove = () => {
    if (!result) return;
    const def: CustomComponentDefinition = {
      id: `ai_${Date.now()}`,
      name: result.componentName || 'AI Component',
      category: result.category || 'AI Generated',
      pins: result.pins || [],
      subcircuit: result.subcircuit || { nodes: [], edges: [] },
      symbolShape: 'DIP_CHIP',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    onSave(def);
  };

  return (
    <div className="modal-overlay">
      <div className="ai-modal">
        <h2>Multimodal AI Circuit Intake</h2>
        
        {!result && !loading && (
          <div className="ai-upload">
            <input type="text" placeholder="Optional context prompt..." value={prompt} onChange={e => setPrompt(e.target.value)} className="ai-prompt" />
            <div className="dropzone" onClick={() => fileInputRef.current?.click()}>
              Drop photo or click to upload
            </div>
            <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} />
          </div>
        )}

        {loading && <div className="ai-loading">Synthesizing circuit with AI...</div>}

        {result && (
          <div className="ai-result">
            <h3>{result.componentName} <span className="ai-confidence">Confidence: {(result.confidence * 100).toFixed(0)}%</span></h3>
            
            <div className="ai-pins">
              <h4>Pins</h4>
              <ul>
                {result.pins.map((pin: {id: string; label: string; type: string; side: string}) => {
                  const unverified = result.unverifiedPins?.includes(pin.label);
                  return (
                    <li key={pin.id}>
                      <span className={`ai-badge ${unverified ? 'amber' : 'green'}`}></span>
                      {pin.label} ({pin.type} - {pin.side})
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="ai-actions">
              <button onClick={() => setResult(null)}>Try Again</button>
              <button onClick={handleApprove} className="primary-btn">Approve & Save to My Library</button>
            </div>
          </div>
        )}

        <button className="ai-close" onClick={onClose}>✕</button>
      </div>
    </div>
  );
}
