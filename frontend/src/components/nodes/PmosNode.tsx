/**
 * @file PmosNode.tsx
 * @description Cadence Virtuoso EDA Schematic Symbol for 4-Terminal PMOS Transistor.
 * Direct vector schematic lines with inversion bubble, red square terminal pins, and floating CDF annotations.
 * No card or box container. Double-click opens Virtuoso Object Properties Modal.
 */

import React from 'react';
import { Handle, Position } from 'reactflow';
import type { AnalogNodeProps, TechNode } from '../../types';
import './MosfetNode.css';

/**
 * Cadence Virtuoso-style Red Square Terminal Pin Handle.
 */
function VirtuosoPinHandle({ terminal, position, style }: { terminal: string; position: Position; style?: React.CSSProperties }): React.ReactElement {
  return (
    <>
      <Handle type="target" id={`t:${terminal}`} position={position} className="virtuoso-pin" style={style} />
      <Handle type="source" id={`s:${terminal}`} position={position} className="virtuoso-pin" style={style} />
    </>
  );
}

export function PmosNode({ id, data }: AnalogNodeProps): React.ReactElement {
  const techNode: TechNode = data.techNode ?? '180nm';
  const width = data.width ?? 2.4; // um
  const length = data.length ?? 0.18; // um
  const label = data.label || 'PM0';
  const region = data.region;
  const autoBulk = data.autoBulk !== false;

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('digisim:open-node-properties', { detail: { nodeId: id } }));
  };

  return (
    <div
      className="virtuoso-schematic-symbol pmos-symbol"
      onDoubleClick={handleDoubleClick}
      title="PMOS Transistor (Double-click or press Q to edit Virtuoso Object Properties)"
    >
      {/* Red Square Terminal Pins placed precisely at wire ends */}
      {/* Source: Top wire end */}
      <VirtuosoPinHandle terminal="s" position={Position.Top} style={{ top: 0, left: 34 }} />
      {/* Gate: Left wire end */}
      <VirtuosoPinHandle terminal="g" position={Position.Left} style={{ top: 27, left: 0 }} />
      {/* Drain: Bottom wire end */}
      <VirtuosoPinHandle terminal="d" position={Position.Bottom} style={{ top: 54, left: 34 }} />
      {/* Bulk: Body terminal */}
      <VirtuosoPinHandle terminal="b" position={Position.Right} style={{ top: 27, left: 34 }} />

      {/* Cadence Virtuoso Floating CDF Annotations matching reference image */}
      <div className="virtuoso-annotation virtuoso-annotation--top-left">
        <span className="virtuoso-cell-type">pmos</span>
      </div>
      <div className="virtuoso-annotation virtuoso-annotation--top-right">
        <span className="virtuoso-instance-name">{label}</span>
        <span className="virtuoso-model-name">"pmos_{techNode}"</span>
        <span className="virtuoso-cdf-param">w:{width}u</span>
      </div>
      <div className="virtuoso-annotation virtuoso-annotation--bottom-right">
        <span className="virtuoso-cdf-param">l:{Math.round(length * 1000)}n</span>
        <span className="virtuoso-cdf-param">m:1</span>
        {region && <span className={`virtuoso-region-tag virtuoso-region--${region.toLowerCase()}`}>{region}</span>}
      </div>

      {/* Pure Vector Schematic Geometry */}
      <svg width="68" height="54" viewBox="0 0 68 54" className="virtuoso-symbol-svg" aria-label="PMOS Schematic Symbol">
        {/* Gate Terminal Lead and Inversion Bubble */}
        <line x1="0" y1="27" x2="11" y2="27" className="symbol-wire" />
        <circle cx="14" cy="27" r="3" className="symbol-bubble" fill="none" />
        <line x1="17" y1="12" x2="17" y2="42" className="symbol-plate" />

        {/* Channel Plate (Oxide Gap) */}
        <line x1="22" y1="10" x2="22" y2="44" className="symbol-plate" />

        {/* Source Lead (Top) */}
        <line x1="22" y1="15" x2="34" y2="15" className="symbol-wire" />
        <line x1="34" y1="15" x2="34" y2="0" className="symbol-wire" />

        {/* Drain Lead (Bottom) */}
        <line x1="22" y1="39" x2="34" y2="39" className="symbol-wire" />
        <line x1="34" y1="39" x2="34" y2="54" className="symbol-wire" />

        {/* Bulk Channel Connection */}
        <line x1="22" y1="27" x2="34" y2="27" className="symbol-wire" />
        {/* Substrate Arrow pointing OUT from channel */}
        <polygon points="32,27 24,23 24,31" className="symbol-arrow" />

        {/* Auto-Bulk Loop Wire connecting Bulk to Source if enabled */}
        {autoBulk && (
          <path d="M 34,27 L 44,27 L 44,9 L 34,9" fill="none" className="symbol-wire symbol-wire--autobulk" />
        )}
      </svg>
    </div>
  );
}

export default PmosNode;
