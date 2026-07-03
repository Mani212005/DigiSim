/**
 * @file DetectionReview.js
 * @description Review/confirm step shown when the detector returns any component
 * below the 0.95 confidence bar. Lists every detected component with a type
 * dropdown for correcting misclassifications and a checkbox to drop false
 * positives — nothing lands on the canvas until the user confirms.
 */

import React, { useState } from 'react';

/** Selectable node types for correcting a detection. */
const TYPE_OPTIONS = [
  { type: 'andGate', label: 'AND Gate' },
  { type: 'orGate', label: 'OR Gate' },
  { type: 'notGate', label: 'NOT Gate' },
  { type: 'nandGate', label: 'NAND Gate' },
  { type: 'norGate', label: 'NOR Gate' },
  { type: 'xorGate', label: 'XOR Gate' },
  { type: 'xnorGate', label: 'XNOR Gate' },
  { type: 'input', label: 'Input' },
  { type: 'output', label: 'Output' },
];

const CONFIDENCE_BAR = 0.95;

/**
 * Modal listing detections for review before committing to the canvas.
 * @param {{ payload: import('../types/api').CircuitExportJSON,
 *   onConfirm: (payload: object) => void, onCancel: () => void }} props -
 *   Raw detection payload and confirm/cancel callbacks
 * @returns {React.ReactElement} Rendered review dialog
 */
function DetectionReview({ payload, onConfirm, onCancel }) {
  const [rows, setRows] = useState(() =>
    payload.components.map((component) => ({
      ...component,
      keep: true,
    }))
  );

  /**
   * Update one review row.
   * @param {string} id - Component id
   * @param {object} patch - Fields to merge
   */
  const updateRow = (id, patch) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  /** Commit kept rows (with corrected types) and their surviving connections. */
  const confirm = () => {
    const kept = rows.filter((r) => r.keep);
    const keptIds = new Set(kept.map((r) => r.id));
    onConfirm({
      ...payload,
      components: kept.map((row) => {
        const { keep: _keep, ...component } = row;
        void _keep;
        return {
          ...component,
          label:
            TYPE_OPTIONS.find((o) => o.type === component.type)?.label ||
            component.label,
        };
      }),
      connections: payload.connections.filter(
        (c) => keptIds.has(c.from) && keptIds.has(c.to)
      ),
    });
  };

  return (
    <div className="review-backdrop" role="dialog" aria-label="Review detections">
      <div className="review-card">
        <h2>Review detections</h2>
        <p className="review-sub">
          Some components were detected below {Math.round(CONFIDENCE_BAR * 100)}%
          confidence. Correct or drop them before placing on the canvas.
        </p>
        <div className="review-list">
          {rows.map((row) => (
            <div
              key={row.id}
              className={`review-row${row.keep ? '' : ' review-row--dropped'}`}
            >
              <input
                type="checkbox"
                checked={row.keep}
                aria-label={`Keep ${row.label}`}
                onChange={(e) => updateRow(row.id, { keep: e.target.checked })}
              />
              <select
                value={row.type}
                aria-label={`Type for ${row.id}`}
                disabled={!row.keep}
                onChange={(e) => updateRow(row.id, { type: e.target.value })}
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.type} value={o.type}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span
                className={`review-conf${
                  row.confidence < CONFIDENCE_BAR ? ' review-conf--low' : ''
                }`}
              >
                {(row.confidence * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
        <div className="review-actions">
          <button className="review-cancel" onClick={onCancel}>
            Discard
          </button>
          <button className="review-confirm" onClick={confirm}>
            Place {rows.filter((r) => r.keep).length} components
          </button>
        </div>
      </div>
    </div>
  );
}

export default DetectionReview;
