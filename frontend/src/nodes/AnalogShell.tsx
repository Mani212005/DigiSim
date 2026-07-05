/**
 * @file AnalogShell.tsx
 * @description Shared visual shell for analog part nodes — renders the
 * schematic glyph, label, live readout (mA/V), overcurrent warning chip, and
 * the electrical terminals as paired target+source handles (`t:<terminal>` /
 * `s:<terminal>`) so wires can be drawn in either direction. No simulation
 * logic lives here — solving happens in src/logic/simulation/mna.ts.
 */

import React from 'react';
import { Handle, Position } from 'reactflow';
import type { AnalogShellProps, AnalogTerminal, TerminalSide } from '../types';

const POSITION_BY_SIDE: Record<TerminalSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
};

/**
 * One electrical terminal rendered as stacked target+source handles.
 * @param props - Terminal name and node side
 * @returns Paired ReactFlow handles
 */
function TerminalHandles({ terminal, side }: AnalogTerminal): React.ReactElement {
  const position = POSITION_BY_SIDE[side];
  return (
    <>
      <Handle type="target" id={`t:${terminal}`} position={position} className="analog-pin" />
      <Handle type="source" id={`s:${terminal}`} position={position} className="analog-pin" />
    </>
  );
}

/**
 * Shared shell for all analog part nodes.
 * @param props - Glyph, terminals, readout, and optional param editor children
 * @returns Rendered analog node card
 */
function AnalogShell({
  data,
  glyph,
  terminals,
  readout,
  onGlyphClick,
  children,
}: AnalogShellProps): React.ReactElement {
  return (
    <div className={`analog-node${data.simWarning ? ' analog-node--warn' : ''}`}>
      {terminals.map((t) => (
        <TerminalHandles key={t.terminal} terminal={t.terminal} side={t.side} />
      ))}
      <div
        className={`analog-node__glyph${onGlyphClick ? ' analog-node__glyph--click' : ''}`}
        onClick={onGlyphClick}
        role={onGlyphClick ? 'button' : undefined}
        aria-label={onGlyphClick ? `Toggle ${data.label}` : undefined}
      >
        {glyph}
      </div>
      <div className="analog-node__label">{data.label}</div>
      {children}
      {readout && <div className="analog-node__readout">{readout}</div>}
      {data.simWarning && (
        <div className="analog-node__warning" title={data.simWarning}>
          ⚠ {data.simWarning}
        </div>
      )}
    </div>
  );
}

export default AnalogShell;
