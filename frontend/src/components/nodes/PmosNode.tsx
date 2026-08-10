/**
 * @file PmosNode.tsx
 * @description 4-Terminal PMOS Transistor Node component for ReactFlow canvas.
 * Features 4 handles (Drain, Gate, Source, Bulk), auto-bulk fallback to VDD,
 * live operating region badges (Cutoff, Triode, Saturation), parameter editing (W, L, nf, PDK),
 * and CDF parameter readout.
 */

import React from 'react';
import { Handle, Position } from 'reactflow';
import { PDKManager } from '../../logic/pdk/PDKManager';
import type { AnalogNodeProps, TechNode } from '../../types';
import './MosfetNode.css';

/**
 * Stacked target+source handles for one MOSFET terminal.
 */
function MosfetHandle({ terminal, position }: { terminal: string; position: Position }): React.ReactElement {
  return (
    <>
      <Handle type="target" id={`t:${terminal}`} position={position} className={`mosfet-handle mosfet-handle--${terminal}`} />
      <Handle type="source" id={`s:${terminal}`} position={position} className={`mosfet-handle mosfet-handle--${terminal}`} />
    </>
  );
}

export function PmosNode({ id, data, updateNodeData }: AnalogNodeProps): React.ReactElement {
  const techNode: TechNode = data.techNode ?? '180nm';
  const width = data.width ?? 2.4; // um (PMOS typically 2x NMOS width)
  const length = data.length ?? 0.18; // um
  const nf = data.nf ?? 1;
  const autoBulk = data.autoBulk ?? true;

  const model = PDKManager.getModelCard(techNode, 'pmos');
  const cdf = PDKManager.calculateCDF(techNode, width, length, nf);

  const vdrop = data.voltageDrop ?? 0;
  const current = data.current ?? 0;

  // Evaluate default operating region estimate for display
  const opResult = PDKManager.calculateOperatingRegion(
    'pmos',
    model,
    width,
    length,
    nf,
    vdrop, // Vd estimate
    0, // Vg estimate
    model.Vdd, // Vs estimate (VDD)
    model.Vdd // Vb estimate (VDD)
  );

  const region = data.region ?? opResult.region;
  const ids = current > 0 ? current : opResult.ids;

  const regionBadgeClass =
    region === 'Saturation'
      ? 'mosfet-badge--sat'
      : region === 'Triode'
        ? 'mosfet-badge--triode'
        : 'mosfet-badge--cutoff';

  return (
    <div className="mosfet-node pmos-node">
      {/* 4 Handles: Source (top), Gate (left), Drain (bottom), Bulk (right) */}
      <MosfetHandle terminal="s" position={Position.Top} />
      <MosfetHandle terminal="g" position={Position.Left} />
      <MosfetHandle terminal="d" position={Position.Bottom} />
      <MosfetHandle terminal="b" position={Position.Right} />

      <div className="mosfet-header">
        <span className="mosfet-title">{data.label || 'PMOS'}</span>
        <span className={`mosfet-badge ${regionBadgeClass}`}>{region}</span>
      </div>

      {/* Schematic SVG Glyph */}
      <div className="mosfet-glyph">
        <svg width="60" height="50" viewBox="0 0 60 50" aria-label="PMOS Schematic Symbol">
          {/* Gate Line with Inverting Bubble */}
          <line x1="0" y1="25" x2="14" y2="25" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="17" cy="25" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1="20" y1="12" x2="20" y2="38" stroke="currentColor" strokeWidth="2" />
          {/* Oxide gap */}
          <line x1="25" y1="10" x2="25" y2="40" stroke="currentColor" strokeWidth="2" />

          {/* Source Line (Top for PMOS) */}
          <line x1="25" y1="14" x2="45" y2="14" stroke="currentColor" strokeWidth="1.5" />
          <line x1="45" y1="14" x2="45" y2="0" stroke="currentColor" strokeWidth="1.5" />

          {/* Drain Line (Bottom for PMOS) */}
          <line x1="25" y1="36" x2="45" y2="36" stroke="currentColor" strokeWidth="1.5" />
          <line x1="45" y1="36" x2="45" y2="50" stroke="currentColor" strokeWidth="1.5" />

          {/* Bulk Channel Line (Middle) */}
          <line x1="25" y1="25" x2="60" y2="25" stroke="currentColor" strokeWidth="1.5" />
          {/* PMOS Substrate Arrow (pointing OUT away from channel) */}
          <polygon points="35,25 28,21 28,29" fill="currentColor" />

          {/* Labels for S, G, D, B */}
          <text x="47" y="10" className="mosfet-pin-label">S</text>
          <text x="5" y="20" className="mosfet-pin-label">G</text>
          <text x="47" y="46" className="mosfet-pin-label">D</text>
          <text x="50" y="22" className="mosfet-pin-label">B</text>
        </svg>
      </div>

      {/* Auto-Bulk Indicator */}
      <div className="mosfet-autobulk">
        <label className="nodrag">
          <input
            type="checkbox"
            checked={autoBulk}
            onChange={(e) => updateNodeData(id, { autoBulk: e.target.checked })}
          />
          Auto-Bulk ({model.Vdd}V VDD)
        </label>
      </div>

      {/* PDK Controls & Parameter Inputs */}
      <div className="mosfet-params nodrag">
        <div className="mosfet-row">
          <span className="mosfet-label">PDK:</span>
          <select
            value={techNode}
            onChange={(e) => updateNodeData(id, { techNode: e.target.value as TechNode })}
            className="mosfet-select"
          >
            <option value="180nm">180nm CMOS</option>
            <option value="90nm">90nm CMOS</option>
            <option value="28nm">28nm HKMG</option>
          </select>
        </div>

        <div className="mosfet-row">
          <label title="Width in microns">
            W:
            <input
              type="number"
              step="0.05"
              min="0.05"
              value={width}
              onChange={(e) => updateNodeData(id, { width: Number(e.target.value) })}
              className="mosfet-input"
            />
            μm
          </label>
          <label title="Length in microns">
            L:
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={length}
              onChange={(e) => updateNodeData(id, { length: Number(e.target.value) })}
              className="mosfet-input"
            />
            μm
          </label>
          <label title="Fingers">
            nf:
            <input
              type="number"
              min="1"
              value={nf}
              onChange={(e) => updateNodeData(id, { nf: Number(e.target.value) })}
              className="mosfet-input mosfet-input--short"
            />
          </label>
        </div>
      </div>

      {/* CDF Readout */}
      <div className="mosfet-cdf-readout" title="CDF Diffusion Geometry">
        <span>ad:{cdf.ad}p</span> <span>as:{cdf.as}p</span> <span>pd:{cdf.pd}u</span> <span>ps:{cdf.ps}u</span>
      </div>

      {/* Live Readout */}
      <div className="mosfet-readout">
        <span>Ids: {(ids * 1000).toFixed(3)} mA</span>
      </div>
    </div>
  );
}

export default PmosNode;
