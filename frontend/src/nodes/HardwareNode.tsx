/**
 * @file HardwareNode.tsx
 * @description Canvas node for a shared-library hardware component (dev board,
 * sensor, passive…). Renders a card with the part name, category, an optional
 * reference-image thumbnail, and one connection point per pin generated from
 * the library pin map. Every pin exposes both a target and a source handle so
 * bidirectional pins (GPIO) can be wired either way. No logic evaluation here —
 * behavioral models arrive with the simulation phases.
 */

import React from 'react';
import { Handle, Position } from 'reactflow';
import type { HardwareNodeProps, LibraryPin } from '../types';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

/** Fallback glyph per library category when the part has no reference image. */
const CATEGORY_GLYPH: Record<string, string> = {
  board: '⬛',
  sensor: '◈',
  display: '▤',
  actuator: '↻',
  driver: '⇄',
  comms: '⌁',
  ic: '▦',
  passive: '⏛',
  semiconductor: '▷',
  power: '⚡',
  io: '⏻',
  infrastructure: '▦',
};

const SIDE_POSITION: Record<LibraryPin['side'], Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

/**
 * Fractional offset (percent) of pin i among n pins along one side.
 * @param index - Pin index on its side
 * @param count - Total pins on that side
 * @returns Percentage string for the handle position
 */
const spread = (index: number, count: number): string =>
  `${(((index + 1) / (count + 1)) * 100).toFixed(2)}%`;

/**
 * Target + source handle pair (stacked) plus a label for one pin.
 * @param props - Pin, its side index, and the side's pin count
 * @returns Handles and label positioned on the card edge
 */
function PinPoint({
  pin,
  index,
  count,
}: {
  pin: LibraryPin;
  index: number;
  count: number;
}): React.ReactElement {
  const vertical = pin.side === 'left' || pin.side === 'right';
  const offset = spread(index, count);
  const style = vertical ? { top: offset } : { left: offset };
  const position = SIDE_POSITION[pin.side];
  return (
    <>
      <Handle
        type="target"
        id={`t:${pin.name}`}
        position={position}
        style={style}
        className={`hw-pin hw-pin--${pin.role}`}
      />
      <Handle
        type="source"
        id={`s:${pin.name}`}
        position={position}
        style={style}
        className={`hw-pin hw-pin--${pin.role}`}
      />
      <span
        className={`hw-pin-label hw-pin-label--${pin.side}`}
        style={vertical ? { top: offset } : { left: offset }}
        title={`${pin.name} (${pin.role})`}
      >
        {pin.name}
      </span>
    </>
  );
}

/**
 * Hardware component node.
 * @param props - Node data (label, pins, category, thumbnail image id)
 * @returns Rendered hardware card with pin handles
 */
function HardwareNode({ data }: HardwareNodeProps): React.ReactElement {
  const pins = data.pins ?? [];
  const bySide = (side: LibraryPin['side']): LibraryPin[] =>
    pins.filter((pin) => pin.side === side);
  const left = bySide('left');
  const right = bySide('right');
  const top = bySide('top');
  const bottom = bySide('bottom');

  const rows = Math.max(left.length, right.length);
  const cols = Math.max(top.length, bottom.length);
  const style: React.CSSProperties = {
    minHeight: Math.max(88, rows * 20 + 58),
    minWidth: Math.max(170, cols * 30 + 60),
    paddingLeft: left.length > 0 ? 52 : 14,
    paddingRight: right.length > 0 ? 52 : 14,
    paddingTop: top.length > 0 ? 40 : 10,
    paddingBottom: bottom.length > 0 ? 40 : 10,
  };

  return (
    <div className="hw-node" style={style}>
      {left.map((pin, i) => (
        <PinPoint key={`l${i}`} pin={pin} index={i} count={left.length} />
      ))}
      {right.map((pin, i) => (
        <PinPoint key={`r${i}`} pin={pin} index={i} count={right.length} />
      ))}
      {top.map((pin, i) => (
        <PinPoint key={`t${i}`} pin={pin} index={i} count={top.length} />
      ))}
      {bottom.map((pin, i) => (
        <PinPoint key={`b${i}`} pin={pin} index={i} count={bottom.length} />
      ))}

      {data.imageId != null ? (
        <img
          className="hw-node__thumb"
          src={`${API_URL}/library/images/${data.imageId}`}
          alt={data.label}
          crossOrigin="use-credentials"
          draggable={false}
        />
      ) : (
        <span className="hw-node__glyph" aria-hidden="true">
          {CATEGORY_GLYPH[data.category ?? ''] ?? '▣'}
        </span>
      )}
      <span className="hw-node__name">{data.label}</span>
      <span className="hw-node__meta">
        {data.category ?? 'component'} · {pins.length} pins
      </span>
    </div>
  );
}

export default HardwareNode;
