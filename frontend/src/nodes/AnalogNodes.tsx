/**
 * @file AnalogNodes.tsx
 * @description The six analog part nodes (voltage source, ground, resistor,
 * LED, switch, potentiometer) — thin wrappers around AnalogShell that draw
 * each part's schematic glyph and expose its editable parameters. Solver
 * outputs (data.current/brightness/simWarning) are display-only here; all
 * electrical behavior lives in src/logic/simulation/mna.ts.
 */

import React from 'react';
import AnalogShell from './AnalogShell';
import type { AnalogNodeProps, HardwareNodeProps } from '../types';

/**
 * Format amps for the readout line.
 * @param amps - Branch current in amperes
 * @returns Human string like '13.6 mA'
 */
const formatCurrent = (amps: number | undefined): string =>
  `${((amps ?? 0) * 1000).toFixed(1)} mA`;

/**
 * DC voltage source with an editable volts parameter.
 * @param props - Node id, data, and the state updater
 * @returns Rendered battery node
 */
export function VSourceNode({ id, data, updateNodeData }: AnalogNodeProps): React.ReactElement {
  return (
    <AnalogShell
      data={data}
      terminals={[
        { terminal: 'pos', side: 'left' },
        { terminal: 'neg', side: 'right' },
      ]}
      readout={formatCurrent(data.current)}
      glyph={
        <svg width="48" height="30" viewBox="0 0 48 30" aria-hidden="true">
          <line x1="0" y1="15" x2="19" y2="15" />
          <line x1="19" y1="4" x2="19" y2="26" />
          <line x1="27" y1="10" x2="27" y2="20" strokeWidth="3.4" />
          <line x1="27" y1="15" x2="48" y2="15" />
          <text x="12" y="9" className="analog-glyph-sign">+</text>
        </svg>
      }
    >
      <label className="analog-node__param nodrag">
        <input
          type="number"
          min={0}
          max={48}
          step={0.5}
          value={data.param ?? 5}
          aria-label={`Voltage for ${data.label}`}
          onChange={(e) => updateNodeData(id, { param: Number(e.target.value) })}
        />
        V
      </label>
    </AnalogShell>
  );
}

/**
 * Ground reference node (single terminal, defines 0V for its island).
 * @param props - Node data
 * @returns Rendered ground node
 */
export function GroundNode({ data }: HardwareNodeProps): React.ReactElement {
  return (
    <AnalogShell
      data={data}
      terminals={[{ terminal: 'gnd', side: 'top' }]}
      glyph={
        <svg width="30" height="24" viewBox="0 0 30 24" aria-hidden="true">
          <line x1="15" y1="0" x2="15" y2="9" />
          <line x1="3" y1="9" x2="27" y2="9" />
          <line x1="8" y1="15" x2="22" y2="15" />
          <line x1="12" y1="21" x2="18" y2="21" />
        </svg>
      }
    />
  );
}

/**
 * Resistor with an editable ohms parameter.
 * @param props - Node id, data, and the state updater
 * @returns Rendered resistor node
 */
export function ResistorNode({ id, data, updateNodeData }: AnalogNodeProps): React.ReactElement {
  return (
    <AnalogShell
      data={data}
      terminals={[
        { terminal: 'a', side: 'left' },
        { terminal: 'b', side: 'right' },
      ]}
      readout={formatCurrent(data.current)}
      glyph={
        <svg width="48" height="30" viewBox="0 0 48 30" aria-hidden="true">
          <path d="M0 15 L9 15 L13 6 L19 24 L25 6 L31 24 L35 15 L48 15" fill="none" />
        </svg>
      }
    >
      <label className="analog-node__param nodrag">
        <input
          type="number"
          min={1}
          step={10}
          value={data.param ?? 220}
          aria-label={`Resistance for ${data.label}`}
          onChange={(e) => updateNodeData(id, { param: Number(e.target.value) })}
        />
        Ω
      </label>
    </AnalogShell>
  );
}

/**
 * LED — glows with solver brightness; flags overcurrent via data.simWarning.
 * @param props - Node data
 * @returns Rendered LED node
 */
export function LedNode({ data }: HardwareNodeProps): React.ReactElement {
  const brightness = data.brightness ?? 0;
  return (
    <AnalogShell
      data={data}
      terminals={[
        { terminal: 'anode', side: 'left' },
        { terminal: 'cathode', side: 'right' },
      ]}
      readout={formatCurrent(data.current)}
      glyph={
        <svg width="48" height="34" viewBox="0 0 48 34" aria-hidden="true">
          <circle cx="22" cy="19" r="13" className="analog-led-glow" style={{ opacity: brightness * 0.9 }} />
          <line x1="0" y1="19" x2="14" y2="19" />
          <path d="M14 10 L14 28 L29 19 Z" fill="none" />
          <line x1="29" y1="10" x2="29" y2="28" />
          <line x1="29" y1="19" x2="48" y2="19" />
          <path d="M24 7 L30 1 M27 1 L30 1 L30 4" fill="none" />
          <path d="M31 10 L37 4 M34 4 L37 4 L37 7" fill="none" />
        </svg>
      }
    />
  );
}

/**
 * SPST switch — click the glyph to open/close it.
 * @param props - Node id, data, and the state updater
 * @returns Rendered switch node
 */
export function AnalogSwitchNode({ id, data, updateNodeData }: AnalogNodeProps): React.ReactElement {
  const closed = data.closed ?? false;
  return (
    <AnalogShell
      data={data}
      terminals={[
        { terminal: 'a', side: 'left' },
        { terminal: 'b', side: 'right' },
      ]}
      readout={closed ? formatCurrent(data.current) : 'open'}
      onGlyphClick={() => updateNodeData(id, { closed: !closed })}
      glyph={
        <svg width="48" height="30" viewBox="0 0 48 30" aria-hidden="true">
          <line x1="0" y1="19" x2="14" y2="19" />
          <circle cx="15" cy="19" r="2.2" fill="currentColor" />
          <line x1="15" y1="19" x2={closed ? 31 : 28} y2={closed ? 19 : 6} />
          <circle cx="32" cy="19" r="2.2" fill="currentColor" />
          <line x1="33" y1="19" x2="48" y2="19" />
        </svg>
      }
    />
  );
}

/**
 * Potentiometer (rheostat mode) — slider picks % of the max resistance.
 * @param props - Node id, data, and the state updater
 * @returns Rendered potentiometer node
 */
export function PotentiometerNode({
  id,
  data,
  updateNodeData,
}: AnalogNodeProps): React.ReactElement {
  const percent = data.percent ?? 50;
  const max = data.param ?? 10000;
  const effective = Math.round((max * percent) / 100);
  return (
    <AnalogShell
      data={data}
      terminals={[
        { terminal: 'a', side: 'left' },
        { terminal: 'b', side: 'right' },
      ]}
      readout={`${effective >= 1000 ? `${(effective / 1000).toFixed(1)}k` : effective}Ω · ${formatCurrent(data.current)}`}
      glyph={
        <svg width="48" height="34" viewBox="0 0 48 34" aria-hidden="true">
          <path d="M0 20 L9 20 L13 12 L19 28 L25 12 L31 28 L35 20 L48 20" fill="none" />
          <path d="M22 2 L22 9 M18 6 L22 10 L26 6" fill="none" />
        </svg>
      }
    >
      <label className="analog-node__param nodrag">
        <input
          type="range"
          min={0}
          max={100}
          value={percent}
          aria-label={`Wiper position for ${data.label}`}
          onChange={(e) => updateNodeData(id, { percent: Number(e.target.value) })}
        />
        {percent}%
      </label>
    </AnalogShell>
  );
}
