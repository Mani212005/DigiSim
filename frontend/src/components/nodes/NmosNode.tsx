/**
 * @file NmosNode.tsx
 * @description Clean, Professional 4-Terminal NMOS Transistor Node for ReactFlow canvas (Cadence Virtuoso Style).
 * Displays a clean IEEE schematic symbol with subtle instance & geometry text.
 * Double-clicking opens the deep Virtuoso Object Properties Inspector.
 */

import React from 'react';
import { Handle, Position } from 'reactflow';
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

export function NmosNode({ id, data }: AnalogNodeProps): React.ReactElement {
  const techNode: TechNode = data.techNode ?? '180nm';
  const width = data.width ?? 1.2; // um
  const length = data.length ?? 0.18; // um
  const label = data.label || 'NMOS';
  const region = data.region;

  const regionDotClass =
    region === 'Saturation'
      ? 'mosfet-dot--sat'
      : region === 'Triode'
        ? 'mosfet-dot--triode'
        : region === 'Cutoff'
          ? 'mosfet-dot--cutoff'
          : '';

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Dispatch custom event caught by App.tsx to open the Properties Modal
    window.dispatchEvent(new CustomEvent('digisim:open-node-properties', { detail: { nodeId: id } }));
  };

  return (
    <div
      className="mosfet-node mosfet-node--pro nmos-node"
      onDoubleClick={handleDoubleClick}
      title="Double-click to edit Cadence Virtuoso Object Properties (W, L, PDK, Bulk)"
    >
      {/* 4 Standard IEEE Terminals: Drain (top), Gate (left), Source (bottom), Bulk (right) */}
      <MosfetHandle terminal="d" position={Position.Top} />
      <MosfetHandle terminal="g" position={Position.Left} />
      <MosfetHandle terminal="s" position={Position.Bottom} />
      <MosfetHandle terminal="b" position={Position.Right} />

      {/* Clean Header: Instance Tag + Status Dot */}
      <div className="mosfet-pro-header">
        <span className="mosfet-pro-title">{label}</span>
        {region && <span className={`mosfet-status-dot ${regionDotClass}`} title={`Region: ${region}`} />}
      </div>

      {/* Clean IEEE Schematic SVG Glyph */}
      <div className="mosfet-pro-glyph">
        <svg width="68" height="54" viewBox="0 0 68 54" aria-label="NMOS Schematic Symbol">
          {/* Gate Terminal (Left) */}
          <line x1="0" y1="27" x2="22" y2="27" stroke="currentColor" strokeWidth="1.6" />
          <line x1="22" y1="12" x2="22" y2="42" stroke="currentColor" strokeWidth="2.2" />
          {/* Oxide gap */}
          <line x1="28" y1="10" x2="28" y2="44" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />

          {/* Drain Line (Top) */}
          <line x1="28" y1="15" x2="48" y2="15" stroke="currentColor" strokeWidth="1.6" />
          <line x1="48" y1="15" x2="48" y2="0" stroke="currentColor" strokeWidth="1.6" />

          {/* Source Line (Bottom) */}
          <line x1="28" y1="39" x2="48" y2="39" stroke="currentColor" strokeWidth="1.6" />
          <line x1="48" y1="39" x2="48" y2="54" stroke="currentColor" strokeWidth="1.6" />

          {/* Bulk Channel Line (Middle) */}
          <line x1="28" y1="27" x2="68" y2="27" stroke="currentColor" strokeWidth="1.6" />
          {/* NMOS Substrate Arrow (pointing IN towards channel) */}
          <polygon points="28,27 36,23 36,31" fill="currentColor" />

          {/* Terminal Pin Labels */}
          <text x="50" y="10" className="mosfet-pin-label">D</text>
          <text x="6" y="22" className="mosfet-pin-label">G</text>
          <text x="50" y="50" className="mosfet-pin-label">S</text>
          <text x="58" y="24" className="mosfet-pin-label">B</text>
        </svg>
      </div>

      {/* Subtle Virtuoso-style Monospaced Size Subtitle */}
      <div className="mosfet-pro-specs">
        <span className="mosfet-spec-size">{width}μ / {length}μ</span>
        <span className="mosfet-spec-pdk">{techNode}</span>
      </div>
    </div>
  );
}

export default NmosNode;
