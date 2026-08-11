/**
 * @file AnalogShell.tsx
 * @description Cadence Virtuoso-grade visual shell for analog schematic parts.
 * Renders pure vector schematic lines with red square terminal pins and floating CDF annotations.
 * No box or card containers.
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
 * Cadence Virtuoso Red Square Terminal Pin.
 */
function TerminalHandles({ terminal, side }: AnalogTerminal): React.ReactElement {
  const position = POSITION_BY_SIDE[side];
  return (
    <>
      <Handle type="target" id={`t:${terminal}`} position={position} className="virtuoso-pin" />
      <Handle type="source" id={`s:${terminal}`} position={position} className="virtuoso-pin" />
    </>
  );
}

/**
 * Shared Virtuoso Schematic Shell for Analog components.
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
    <div
      className={`virtuoso-schematic-symbol analog-symbol${data.simWarning ? ' analog-symbol--warn' : ''}`}
    >
      {/* Red Square Terminal Pins */}
      {terminals.map((t) => (
        <TerminalHandles key={t.terminal} terminal={t.terminal} side={t.side} />
      ))}

      {/* Floating Instance and Cell Type Annotation */}
      <div className="virtuoso-annotation virtuoso-annotation--top-right">
        <span className="virtuoso-instance-name">{data.label}</span>
      </div>

      {/* Pure Vector Glyph */}
      <div
        className={`analog-glyph-wrapper${onGlyphClick ? ' analog-glyph-clickable' : ''}`}
        onClick={onGlyphClick}
        role={onGlyphClick ? 'button' : undefined}
      >
        {glyph}
      </div>

      {/* Floating Parameter Specs and Live Readouts */}
      <div className="virtuoso-annotation virtuoso-annotation--bottom-right">
        {children}
        {readout && <span className="virtuoso-live-readout">{readout}</span>}
      </div>

      {data.simWarning && (
        <div className="virtuoso-warn-tooltip" title={data.simWarning}>
          ⚠ {data.simWarning}
        </div>
      )}
    </div>
  );
}

export default AnalogShell;
