/**
 * @file GateShell.tsx
 * @description Shared visual shell for all logic-gate nodes — renders the ANSI/74xx
 * schematic symbol as SVG, gate series badge, port status indicators, and handles.
 * No gate logic lives here — evaluation stays in src/logic/simulation/.
 */

import React from 'react';
import { Handle, Position } from 'reactflow';
import type { GateGlyphProps, GateShellProps, GlyphType } from '../types';

/** Standard 74xx IC chip numbers for logic gates */
const GATE_74XX_MAP: Record<GlyphType, string> = {
  and: '7408',
  nand: '7400',
  or: '7432',
  nor: '7402',
  xor: '7486',
  xnor: '74266',
  not: '7404',
};

/** SVG stroke geometry per gate type, drawn in a 110x70 viewBox. */
const SYMBOLS: Record<GlyphType, React.ReactElement> = {
  and: (
    <>
      <path d="M15 10 L50 10 A25 25 0 0 1 50 60 L15 60 Z" />
      <line x1="0" y1="22" x2="15" y2="22" />
      <line x1="0" y1="48" x2="15" y2="48" />
      <line x1="75" y1="35" x2="100" y2="35" />
    </>
  ),
  nand: (
    <>
      <path d="M12 10 L47 10 A25 25 0 0 1 47 60 L12 60 Z" />
      <circle cx="78" cy="35" r="6" />
      <line x1="0" y1="22" x2="12" y2="22" />
      <line x1="0" y1="48" x2="12" y2="48" />
      <line x1="84" y1="35" x2="100" y2="35" />
    </>
  ),
  or: (
    <>
      <path d="M10 10 Q30 35 10 60 Q48 60 82 35 Q48 10 10 10 Z" />
      <line x1="0" y1="22" x2="14" y2="22" />
      <line x1="0" y1="48" x2="14" y2="48" />
      <line x1="82" y1="35" x2="100" y2="35" />
    </>
  ),
  nor: (
    <>
      <path d="M8 10 Q28 35 8 60 Q44 60 76 35 Q44 10 8 10 Z" />
      <circle cx="83" cy="35" r="6" />
      <line x1="0" y1="22" x2="12" y2="22" />
      <line x1="0" y1="48" x2="12" y2="48" />
      <line x1="89" y1="35" x2="100" y2="35" />
    </>
  ),
  xor: (
    <>
      <path d="M18 10 Q38 35 18 60 Q52 60 84 35 Q52 10 18 10 Z" />
      <path d="M6 10 Q26 35 6 60" fill="none" />
      <line x1="0" y1="22" x2="10" y2="22" />
      <line x1="0" y1="48" x2="10" y2="48" />
      <line x1="84" y1="35" x2="100" y2="35" />
    </>
  ),
  xnor: (
    <>
      <path d="M16 10 Q36 35 16 60 Q49 60 78 35 Q49 10 16 10 Z" />
      <path d="M4 10 Q24 35 4 60" fill="none" />
      <circle cx="85" cy="35" r="6" />
      <line x1="0" y1="22" x2="8" y2="22" />
      <line x1="0" y1="48" x2="8" y2="48" />
      <line x1="91" y1="35" x2="100" y2="35" />
    </>
  ),
  not: (
    <>
      <path d="M22 12 L22 58 L68 35 Z" />
      <circle cx="75" cy="35" r="6" />
      <line x1="0" y1="35" x2="22" y2="35" />
      <line x1="81" y1="35" x2="100" y2="35" />
    </>
  ),
};

/**
 * Small standalone gate glyph for the sidebar palette.
 * @param props - Gate symbol key
 * @returns SVG glyph
 */
export function GateGlyph({ type, className }: GateGlyphProps): React.ReactElement {
  return (
    <svg
      viewBox="0 0 110 70"
      className={`gate-glyph ${className || ''}`}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      {SYMBOLS[type]}
    </svg>
  );
}

/**
 * Visual shell shared by every gate node: 74xx symbol + label + port indicators + handles.
 * @param props - Gate type, node data, input handle count (1 or 2)
 * @returns Rendered gate node
 */
function GateShell({ type, data, inputs = 2 }: GateShellProps): React.ReactElement {
  const active = data.value === 1;
  const chipSeries = GATE_74XX_MAP[type] || '74xx';
  const label = data.label || `${type.toUpperCase()} Gate`;
  const inputAActive = data.inputA === 1 || data.a === 1;
  const inputBActive = data.inputB === 1 || data.b === 1;

  return (
    <div className={`node-card glass cad-node${active ? ' active cad-glow' : ''}`}>
      <div className="node-header cad-header">
        {label} <span className="cad-badge">{chipSeries}</span>
      </div>
      <div className="node-body cad-body">
        <svg
          viewBox="0 0 110 70"
          className="node-gate cad-symbol"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="square"
          strokeLinejoin="miter"
        >
          {SYMBOLS[type]}
        </svg>

        {/* Output Port Status Indicator */}
        <div
          className={`port-indicator port-out ${active ? 'port-out-high' : ''}`}
          style={{ top: '50%', right: '8px' }}
        />
      </div>
      {inputs === 1 ? (
        <>
          <div
            className={`port-indicator port-in ${inputAActive ? 'port-in-high' : ''}`}
            style={{ top: '50%', left: '8px' }}
          />
          <Handle
            type="target"
            position={Position.Left}
            id="a"
            className="handle handle-left cad-handle"
            style={{ top: '50%' }}
          />
        </>
      ) : (
        <>
          <div
            className={`port-indicator port-in ${inputAActive ? 'port-in-high' : ''}`}
            style={{ top: '31%', left: '8px' }}
          />
          <Handle
            type="target"
            position={Position.Left}
            id="a"
            className="handle handle-left cad-handle"
            style={{ top: '31%' }}
          />

          <div
            className={`port-indicator port-in ${inputBActive ? 'port-in-high' : ''}`}
            style={{ top: '69%', left: '8px' }}
          />
          <Handle
            type="target"
            position={Position.Left}
            id="b"
            className="handle handle-left cad-handle"
            style={{ top: '69%' }}
          />
        </>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="handle handle-right cad-handle"
        style={{ top: '50%' }}
      />
    </div>
  );
}

export default GateShell;

