/**
 * @file NetlistImportDialog.tsx
 * @description Modal for importing a canonical JSON netlist onto the canvas —
 * accepts a .json file or a pasted JSON blob (handy for LLM output), validates it
 * live via parseNetlist, lists every specific validation error, and only enables
 * Import once the document parses cleanly.
 */

import React, { useMemo, useRef, useState } from 'react';
import { parseNetlist } from '../logic/netlistIO';
import type { NetlistImportDialogProps, NetlistParseResult } from '../types';
import './NetlistImportDialog.css';

/**
 * Netlist import dialog.
 * @param props - Import confirm and cancel callbacks
 * @returns Rendered modal
 */
function NetlistImportDialog({
  onImport,
  onCancel,
}: NetlistImportDialogProps): React.ReactElement {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const result = useMemo<NetlistParseResult | null>(() => {
    if (!text.trim()) return null;
    try {
      return parseNetlist(JSON.parse(text));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, errors: [`invalid JSON: ${message}`] };
    }
  }, [text]);

  /**
   * Load a picked .json file into the textarea for validation.
   * @param event - File input change event
   */
  const onFilePicked = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setFileName(file.name);
    file
      .text()
      .then(setText)
      .catch(() => setText('') /* unreadable file → empty state */);
  };

  return (
    <div className="review-backdrop" role="dialog" aria-label="Import netlist">
      <div className="review-card netlist-import-card">
        <h2>Import netlist</h2>
        <p className="review-sub">
          Pick a <code>.json</code> netlist file or paste one below — the circuit is
          added next to what&apos;s already on the canvas.
        </p>

        <div className="netlist-import-filebar">
          <button
            className="netlist-import-filebtn"
            onClick={() => fileInputRef.current?.click()}
          >
            Choose .json file
          </button>
          <span className="netlist-import-filename">{fileName ?? 'no file selected'}</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden-file-input"
            aria-label="Netlist JSON file"
            onChange={onFilePicked}
          />
        </div>

        <textarea
          className="netlist-import-text"
          placeholder='{"circuit_name": "…", "components": […], "nets": […], "io": {…}}'
          value={text}
          spellCheck={false}
          aria-label="Netlist JSON"
          onChange={(e) => {
            setText(e.target.value);
            setFileName(null);
          }}
        />

        {result && !result.ok && (
          <ul className="netlist-import-errors" role="alert">
            {result.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
        {result?.ok && (
          <p className="netlist-import-summary">
            ✓ {result.circuitName} —{' '}
            {(['input', 'gate', 'output'] as const)
              .map((kind) => {
                const count = result.nodes.filter((n) =>
                  kind === 'gate' ? n.type !== 'input' && n.type !== 'output' : n.type === kind
                ).length;
                return `${count} ${kind}${count === 1 ? '' : 's'}`;
              })
              .join(', ')}
          </p>
        )}

        <div className="review-actions">
          <button className="review-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="review-confirm"
            disabled={!result?.ok}
            onClick={() => {
              if (result?.ok) onImport(result);
            }}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}

export default NetlistImportDialog;
