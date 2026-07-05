/**
 * @file GateShell.tsx
 * @description Shared visual shell for all logic-gate nodes — renders the ANSI
 * schematic symbol as SVG, the gate label, and the input/output handles. The
 * output state (data.value) drives a neon glow via the `gate-node--on` class.
 * No gate logic lives here — evaluation stays in src/logic/simulation/.
 */

import React from 'react';
import { Handle, Position } from 'reactflow';
import type { GateGlyphProps, GateShellProps, GlyphType } from '../types';

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
export function GateGlyph({ type }: GateGlyphProps): React.ReactElement {
  return (
    <svg viewBox="0 0 110 70" className="gate-glyph" aria-hidden="true">
      {SYMBOLS[type]}
    </svg>
  );
}

/**
 * Visual shell shared by every gate node: symbol + label + handles.
 * @param props - Gate type, node data, input handle count (1 or 2)
 * @returns Rendered gate node
 */
function GateShell({ type, data, inputs = 2 }: GateShellProps): React.ReactElement {
  const active = data.value === 1;
  return (
    <div className={`gate-node${active ? ' gate-node--on' : ''}`}>
      {inputs === 1 ? (
        <Handle type="target" position={Position.Left} id="a" style={{ top: '50%' }} />
      ) : (
        <>
          <Handle type="target" position={Position.Left} id="a" style={{ top: '31%' }} />
          <Handle type="target" position={Position.Left} id="b" style={{ top: '69%' }} />
        </>
      )}
      <svg viewBox="0 0 110 70" className="gate-symbol" aria-hidden="true">
        {SYMBOLS[type]}
      </svg>
      <span className="gate-node__label">{data.label}</span>
      <Handle type="source" position={Position.Right} style={{ top: '50%' }} />
    </div>
  );
}

export default GateShell;
