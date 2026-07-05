/**
 * @file HardwareNode.tsx
 * @description Canvas node for a shared-library hardware component (dev board,
 * sensor, passive…). Renders a card with the part name, category, an optional
 * reference-image thumbnail, and one connection point per pin generated from
 * the library pin map. Every pin exposes both a target and a source handle so
 * bidirectional pins (GPIO) can be wired either way. The ⚙ pins panel edits
 * per-pin behavior stubs (HIGH/LOW/blink/PWM) stored in data.pinConfig — the
 * electrical model itself lives in src/logic/simulation/mna.ts.
 */

import React, { useState } from 'react';
import { Handle, Position } from 'reactflow';
import type { HardwareNodeProps, LibraryPin, PinConfig } from '../types';

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

/** Pin roles the behavior panel can configure (power/ground are automatic). */
const CONFIGURABLE_ROLES = new Set(['digital', 'pwm', 'io', 'analog', 'data', 'clock']);

/** Selectable pin behaviors: option value → PinConfig. */
const MODE_OPTIONS: { value: string; label: string; config: PinConfig }[] = [
  { value: 'hiz', label: 'Hi-Z (input)', config: { mode: 'hiz' } },
  { value: 'high', label: 'HIGH', config: { mode: 'high' } },
  { value: 'low', label: 'LOW', config: { mode: 'low' } },
  { value: 'blink:1', label: 'Blink 1 Hz', config: { mode: 'blink', hz: 1 } },
  { value: 'blink:2', label: 'Blink 2 Hz', config: { mode: 'blink', hz: 2 } },
  { value: 'pwm:25', label: 'PWM 25%', config: { mode: 'pwm', duty: 25 } },
  { value: 'pwm:50', label: 'PWM 50%', config: { mode: 'pwm', duty: 50 } },
  { value: 'pwm:75', label: 'PWM 75%', config: { mode: 'pwm', duty: 75 } },
];

/**
 * The option value encoding a pin's current config.
 * @param config - Stored pin config (may be undefined)
 * @returns Matching MODE_OPTIONS value
 */
const modeValue = (config: PinConfig | undefined): string => {
  if (!config || config.mode === 'hiz') return 'hiz';
  if (config.mode === 'blink') return `blink:${config.hz ?? 1}`;
  if (config.mode === 'pwm') return `pwm:${config.duty ?? 50}`;
  return config.mode;
};

/** Pin roles offered by the community-part pin editor. */
const EDITOR_ROLES: { value: LibraryPin['role']; label: string }[] = [
  { value: 'passive', label: 'junction' },
  { value: 'digital', label: 'GPIO' },
  { value: 'power', label: 'power (sources V)' },
  { value: 'ground', label: 'ground' },
  { value: 'analog', label: 'analog' },
  { value: 'io', label: 'I/O' },
];

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
 * @param props - Node data (label, pins, category, thumbnail image id) plus
 *   id/updateNodeData for the pin behavior panel
 * @returns Rendered hardware card with pin handles
 */
function HardwareNode({
  data,
  id,
  updateNodeData,
  onPinsSaved,
}: HardwareNodeProps): React.ReactElement {
  const [panelOpen, setPanelOpen] = useState(false);
  const [newPinName, setNewPinName] = useState('');
  const [newPinRole, setNewPinRole] = useState<LibraryPin['role']>('passive');
  const [newPinSide, setNewPinSide] = useState<LibraryPin['side']>('left');
  const pins = data.pins ?? [];
  const configurable = pins.filter((pin) => CONFIGURABLE_ROLES.has(pin.role));
  const interactive = id !== undefined && !!updateNodeData;
  const canEditPins = interactive && data.editablePins === true;
  const canConfigure = interactive && (configurable.length > 0 || canEditPins);

  /**
   * Store one pin's chosen behavior on the node.
   * @param pinName - Pin to configure
   * @param value - Selected MODE_OPTIONS value
   */
  const setPinMode = (pinName: string, value: string): void => {
    const option = MODE_OPTIONS.find((o) => o.value === value) ?? MODE_OPTIONS[0];
    updateNodeData?.(id as string, {
      pinConfig: { ...data.pinConfig, [pinName]: option.config },
    });
  };

  /**
   * Apply an edited pin list to the node and share it back to the library.
   * @param nextPins - Full replacement pin list
   */
  const savePins = (nextPins: LibraryPin[]): void => {
    updateNodeData?.(id as string, { pins: nextPins });
    if (data.libraryComponentId !== undefined) {
      onPinsSaved?.(data.libraryComponentId, nextPins);
    }
  };

  /** Add the pin from the editor row (ignores empty/duplicate names). */
  const addPin = (): void => {
    const name = newPinName.trim();
    if (!name || pins.some((p) => p.name.toLowerCase() === name.toLowerCase())) return;
    savePins([...pins, { name, role: newPinRole, side: newPinSide }]);
    setNewPinName('');
  };
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
        {(data.current ?? 0) > 0.0001 &&
          ` · ${((data.current ?? 0) * 1000).toFixed(1)} mA`}
      </span>
      {pins.length === 0 && (
        <span className="hw-node__hint">
          {canEditPins ? 'no pins yet — add them via ⚙ pins' : 'no pins defined'}
        </span>
      )}

      {canConfigure && (
        <button
          className="hw-node__pins-btn nodrag"
          aria-label={`Configure pins for ${data.label}`}
          title="Pin behavior (HIGH / LOW / blink / PWM)"
          onClick={() => setPanelOpen((open) => !open)}
        >
          ⚙ pins
        </button>
      )}
      {canConfigure && panelOpen && (
        <div className="hw-pin-panel nodrag nowheel">
          <label className="hw-pin-panel__row hw-pin-panel__row--head">
            logic level
            <select
              value={data.logicVoltage ?? 3.3}
              aria-label={`Logic voltage for ${data.label}`}
              onChange={(e) =>
                updateNodeData?.(id as string, { logicVoltage: Number(e.target.value) })
              }
            >
              <option value={3.3}>3.3 V</option>
              <option value={5}>5 V</option>
            </select>
          </label>
          {configurable.map((pin) => (
            <label key={pin.name} className="hw-pin-panel__row">
              {pin.name}
              <select
                value={modeValue(data.pinConfig?.[pin.name])}
                aria-label={`Mode for pin ${pin.name}`}
                onChange={(e) => setPinMode(pin.name, e.target.value)}
              >
                {MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}

          {canEditPins && (
            <>
              <div className="hw-pin-panel__row hw-pin-panel__row--head">edit pins</div>
              {pins.map((pin) => (
                <div key={pin.name} className="hw-pin-panel__row">
                  <span>
                    {pin.name} · {pin.role} · {pin.side}
                  </span>
                  <button
                    className="hw-pin-panel__remove"
                    aria-label={`Remove pin ${pin.name}`}
                    onClick={() => savePins(pins.filter((p) => p.name !== pin.name))}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className="hw-pin-panel__add">
                <input
                  value={newPinName}
                  placeholder="pin name"
                  aria-label={`New pin name for ${data.label}`}
                  maxLength={24}
                  onChange={(e) => setNewPinName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addPin()}
                />
                <select
                  value={newPinRole}
                  aria-label="New pin role"
                  onChange={(e) => setNewPinRole(e.target.value as LibraryPin['role'])}
                >
                  {EDITOR_ROLES.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
                <select
                  value={newPinSide}
                  aria-label="New pin side"
                  onChange={(e) => setNewPinSide(e.target.value as LibraryPin['side'])}
                >
                  <option value="left">left</option>
                  <option value="right">right</option>
                  <option value="top">top</option>
                  <option value="bottom">bottom</option>
                </select>
                <button
                  className="hw-pin-panel__add-btn"
                  aria-label={`Add pin to ${data.label}`}
                  onClick={addPin}
                >
                  +
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default HardwareNode;
