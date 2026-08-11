/**
 * @file PmosNode.tsx
 * @description Clean, Professional 4-Terminal PMOS Transistor Node for ReactFlow canvas (Cadence Virtuoso Style).
 * Displays a clean IEEE PMOS schematic symbol (with inversion bubble) and subtle instance & geometry text.
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

export function PmosNode({ id, data }: AnalogNodeProps): React.ReactElement {
  const techNode: TechNode = data.techNode ?? '180nm';
  const width = data.width ?? 2.4; // um
  const length = data.length ?? 0.18; // um
  const label = data.label || 'PMOS';
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
      className="mosfet-node mosfet-node--pro pmos-node"
      onDoubleClick={handleDoubleClick}
      title="Double-click to edit Cadence Virtuoso Object Properties (W, L, PDK, Bulk)"
    >
      {/* 4 Standard IEEE Terminals: Source (top), Gate (left), Drain (bottom), Bulk (right) */}
      <MosfetHandle terminal="s" position={Position.Top} />
      <MosfetHandle terminal="g" position={Position.Left} />
      <MosfetHandle terminal="d" position={Position.Bottom} />
      <MosfetHandle terminal="b" position={Position.Right} />

      {/* Clean Header: Instance Tag + Status Dot */}
      <div className="mosfet-pro-header">
        <span className="mosfet-pro-title">{label}</span>
        {region && <span className={`mosfet-status-dot ${regionDotClass}`} title={`Region: ${region}`} />}
      </div>

      {/* Clean IEEE Schematic SVG Glyph */}
      <div className="mosfet-pro-glyph">
        <svg width="68" height="54" viewBox="0 0 68 54" aria-label="PMOS Schematic Symbol">
          {/* Gate Terminal (Left) with PMOS Inversion Bubble */}
          <line x1="0" y1="27" x2="16" y2="27" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="19" cy="27" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1="22" y1="12" x2="22" y2="42" stroke="currentColor" strokeWidth="2.2" />
          {/* Oxide gap */}
          <line x1="28" y1="10" x2="28" y2="44" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />

          {/* Source Line (Top) */}
          <line x1="28" y1="15" x2="48" y2="15" stroke="currentColor" strokeWidth="1.6" />
          <line x1="48" y1="15" x2="48" y2="0" stroke="currentColor" strokeWidth="1.6" />

          {/* Drain Line (Bottom) */}
          <line x1="28" y1="39" x2="48" y2="39" stroke="currentColor" strokeWidth="1.6" />
          <line x1="48" y1="39" x2="48" y2="54" stroke="currentColor" strokeWidth="1.6" />

          {/* Bulk Channel Line (Middle) */}
          <line x1="28" y1="27" x2="68" y2="27" stroke="currentColor" strokeWidth="1.6" />
          {/* PMOS Substrate Arrow (pointing OUT away from channel) */}
          <polygon points="40,27 32,23 32,31" fill="currentColor" />

          {/* Terminal Pin Labels */}
          <text x="50" y="10" className="mosfet-pin-label">S</text>
          <text x="6" y="22" className="mosfet-pin-label">G</text>
          <text x="50" y="50" className="mosfet-pin-label">D</text>
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

export default PmosNode;
