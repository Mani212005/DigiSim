/**
 * @file ComponentPropertiesModal.tsx
 * @description Cadence Virtuoso-style 'Edit Object Properties' (Q) Modal for DigiSim.
 * Provides deep parametric inspection and editing (PDK, W, L, nf, Auto-Bulk, CDF, SPICE DC OP)
 * when double-clicking any component on the schematic canvas.
 */

import React, { useState, useEffect } from 'react';
import { PDKManager } from '../../logic/pdk/PDKManager';
import type { DigiNode, TechNode } from '../../types';
import './ComponentPropertiesModal.css';

export interface ComponentPropertiesModalProps {
  node: DigiNode | null;
  open: boolean;
  onClose: () => void;
  onUpdateNodeData: (nodeId: string, data: Partial<DigiNode['data']>) => void;
}

export function ComponentPropertiesModal({
  node,
  open,
  onClose,
  onUpdateNodeData,
}: ComponentPropertiesModalProps): React.ReactElement | null {
  const [techNode, setTechNode] = useState<TechNode>('180nm');
  const [width, setWidth] = useState<number>(1.2);
  const [length, setLength] = useState<number>(0.18);
  const [nf, setNf] = useState<number>(1);
  const [autoBulk, setAutoBulk] = useState<boolean>(true);
  const [label, setLabel] = useState<string>('');

  useEffect(() => {
    if (node) {
      setTechNode((node.data?.techNode as TechNode) ?? '180nm');
      setWidth(node.data?.width ?? (node.type === 'pmos' ? 2.4 : 1.2));
      setLength(node.data?.length ?? 0.18);
      setNf(node.data?.nf ?? 1);
      setAutoBulk(node.data?.autoBulk ?? true);
      setLabel(node.data?.label ?? node.id);
    }
  }, [node]);

  if (!open || !node) return null;

  const isMosfet = node.type === 'nmos' || node.type === 'pmos';
  const isPmos = node.type === 'pmos';
  const modelType = isPmos ? 'pmos' : 'nmos';
  const model = isMosfet ? PDKManager.getModelCard(techNode, modelType) : null;
  const cdf = isMosfet ? PDKManager.calculateCDF(techNode, width, length, nf) : null;

  // Operating point estimation
  const vdrop = node.data?.voltageDrop ?? 0;
  const vsourceVal = node.data?.param ?? 0;
  const current = node.data?.current ?? 0;
  const opResult =
    isMosfet && model
      ? PDKManager.calculateOperatingRegion(
          modelType,
          model,
          width,
          length,
          nf,
          vdrop,
          vsourceVal,
          0,
          isPmos ? model.Vdd : 0
        )
      : null;

  const region = node.data?.region ?? opResult?.region ?? 'Cutoff';
  const ids = current > 0 ? current : opResult?.ids ?? 0;

  const handleApply = () => {
    if (!node) return;
    onUpdateNodeData(node.id, {
      label,
      techNode,
      width,
      length,
      nf,
      autoBulk,
    });
    onClose();
  };

  return (
    <div className="prop-modal-overlay" onClick={onClose}>
      <div
        className="prop-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="prop-modal-title"
      >
        <div className="prop-modal-header">
          <div className="prop-modal-title-wrap">
            <span className="prop-modal-tag">VIRTUOSO OBJECT PROPERTIES</span>
            <h2 id="prop-modal-title" className="prop-modal-title">
              {node.data?.label || node.id} <span className="prop-modal-type">({node.type?.toUpperCase()})</span>
            </h2>
          </div>
          <button className="prop-modal-close" onClick={onClose} aria-label="Close Properties">
            ✕
          </button>
        </div>

        <div className="prop-modal-body">
          {/* Instance Name */}
          <div className="prop-field-group">
            <label className="prop-field-label">Instance Identifier</label>
            <input
              type="text"
              className="prop-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. M1, INV0"
            />
          </div>

          {isMosfet && (
            <>
              {/* PDK Technology Node Selection */}
              <div className="prop-field-group">
                <label className="prop-field-label">Process Technology Kit (PDK)</label>
                <div className="prop-pdk-grid">
                  {(['180nm', '90nm', '28nm'] as TechNode[]).map((pdk) => (
                    <button
                      key={pdk}
                      type="button"
                      className={`prop-pdk-btn ${techNode === pdk ? 'prop-pdk-btn--active' : ''}`}
                      onClick={() => setTechNode(pdk)}
                    >
                      <span className="prop-pdk-name">
                        {pdk === '180nm' ? '180nm CMOS' : pdk === '90nm' ? '90nm CMOS' : '28nm HKMG'}
                      </span>
                      <span className="prop-pdk-vdd">
                        {pdk === '180nm' ? 'VDD=1.8V' : pdk === '90nm' ? 'VDD=1.2V' : 'VDD=0.9V'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Transistor Geometry Sizing */}
              <div className="prop-section-title">Transistor Geometry (CDF Sizing)</div>
              <div className="prop-grid-3">
                <div className="prop-field-group">
                  <label className="prop-field-label">Total Width (W)</label>
                  <div className="prop-input-addon">
                    <input
                      type="number"
                      step="0.05"
                      min="0.05"
                      className="prop-input"
                      value={width}
                      onChange={(e) => setWidth(Number(e.target.value))}
                    />
                    <span className="prop-addon">μm</span>
                  </div>
                </div>
                <div className="prop-field-group">
                  <label className="prop-field-label">Channel Length (L)</label>
                  <div className="prop-input-addon">
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      className="prop-input"
                      value={length}
                      onChange={(e) => setLength(Number(e.target.value))}
                    />
                    <span className="prop-addon">μm</span>
                  </div>
                </div>
                <div className="prop-field-group">
                  <label className="prop-field-label">Fingers (nf)</label>
                  <input
                    type="number"
                    min="1"
                    className="prop-input"
                    value={nf}
                    onChange={(e) => setNf(Number(e.target.value))}
                  />
                </div>
              </div>

              {/* Auto-Bulk Tie */}
              <div className="prop-field-group prop-toggle-row">
                <div>
                  <div className="prop-field-label">Auto-Bulk Body Tie</div>
                  <div className="prop-field-hint">
                    {autoBulk
                      ? `Automatically ties Bulk handle to ${isPmos ? 'VDD rail' : 'VSS ground'}`
                      : 'Explicit Bulk terminal required on schematic'}
                  </div>
                </div>
                <label className="prop-switch">
                  <input
                    type="checkbox"
                    checked={autoBulk}
                    onChange={(e) => setAutoBulk(e.target.checked)}
                  />
                  <span className="prop-slider" />
                </label>
              </div>

              {/* Calculated CDF Parasitics Readout */}
              {cdf && (
                <div className="prop-cdf-box">
                  <div className="prop-cdf-title">Calculated Layout Diffusion Parasitics</div>
                  <div className="prop-cdf-grid">
                    <div className="prop-cdf-item">
                      <span className="prop-cdf-lbl">Drain Area (ad):</span>
                      <span className="prop-cdf-val">{cdf.ad} μm²</span>
                    </div>
                    <div className="prop-cdf-item">
                      <span className="prop-cdf-lbl">Source Area (as):</span>
                      <span className="prop-cdf-val">{cdf.as} μm²</span>
                    </div>
                    <div className="prop-cdf-item">
                      <span className="prop-cdf-lbl">Drain Perimeter (pd):</span>
                      <span className="prop-cdf-val">{cdf.pd} μm</span>
                    </div>
                    <div className="prop-cdf-item">
                      <span className="prop-cdf-lbl">Source Perimeter (ps):</span>
                      <span className="prop-cdf-val">{cdf.ps} μm</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Real-time SPICE Operating Point */}
              <div className="prop-section-title">SPICE DC Operating Point (Live)</div>
              <div className="prop-op-box">
                <div className="prop-op-item">
                  <span className="prop-op-lbl">Operating Region:</span>
                  <span
                    className={`prop-region-badge prop-region-badge--${region.toLowerCase()}`}
                  >
                    {region.toUpperCase()}
                  </span>
                </div>
                <div className="prop-op-item">
                  <span className="prop-op-lbl">Drain Current (Ids):</span>
                  <span className="prop-op-val">{(ids * 1000).toFixed(4)} mA</span>
                </div>
                <div className="prop-op-item">
                  <span className="prop-op-lbl">Threshold (Vth):</span>
                  <span className="prop-op-val">{model?.Vth0} V</span>
                </div>
              </div>
            </>
          )}

          {!isMosfet && (
            <div className="prop-field-group">
              <label className="prop-field-label">Component Parameter (Value / State)</label>
              <input
                type="number"
                className="prop-input"
                value={node.data?.param ?? 0}
                onChange={(e) =>
                  onUpdateNodeData(node.id, { param: Number(e.target.value) })
                }
              />
            </div>
          )}
        </div>

        <div className="prop-modal-footer">
          <button type="button" className="prop-btn prop-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="prop-btn prop-btn-primary" onClick={handleApply}>
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
}

export default ComponentPropertiesModal;
