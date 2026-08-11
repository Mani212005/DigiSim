/**
 * @file InteractiveProbeTooltip.tsx
 * @description Floating interactive HUD tooltip rendered when hovering over any canvas
 * wire or node terminal. Displays live electrical readings: Voltage V(t) with color-coded
 * gauge from 0V -> VDD, Branch Current I(t) with uA/mA formatting, digital logic state (0/1/X),
 * and a mini SVG sparkline waveform showing the last 20 time samples.
 */

import React, { useEffect, useRef, useState } from 'react';
import type {
  DigiEdge,
  DigiNode,
  InteractiveProbeTooltipProps,
  OperatingRegion,
  ProbedElectricalState,
} from '../../types';
import './InteractiveProbeTooltip.css';

const HISTORY_SAMPLE_COUNT = 20;
const DEFAULT_VDD = 5.0;

/**
 * Format electrical current into human-readable uA, mA, or A units.
 *
 * @param amps - Branch current in Amperes
 * @returns Formatted string with appropriate electrical unit
 */
export function formatProbeCurrent(amps: number): string {
  const absA = Math.abs(amps);
  if (absA < 1e-9) return '0.00 µA';
  if (absA < 1e-3) return `${(amps * 1e6).toFixed(2)} µA`;
  if (absA < 1) return `${(amps * 1e3).toFixed(2)} mA`;
  return `${amps.toFixed(3)} A`;
}

/**
 * Format electrical voltage into fixed decimal reading.
 *
 * @param volts - Potential in Volts
 * @returns Formatted voltage string
 */
export function formatProbeVoltage(volts: number): string {
  return `${volts.toFixed(2)} V`;
}

/**
 * Derive digital logic state from numeric or string value.
 *
 * @param val - Logic value or voltage
 * @returns '0' | '1' | 'X' | 'Z'
 */
export function deriveLogicState(val: number | string | undefined, volts?: number): '0' | '1' | 'X' | 'Z' {
  if (val === 1 || val === '1') return '1';
  if (val === 0 || val === '0') return '0';
  if (val === 'Z' || val === 'z') return 'Z';
  if (val === 'X' || val === 'x') return 'X';

  if (volts !== undefined) {
    if (volts >= 2.0) return '1';
    if (volts <= 0.8) return '0';
    return 'X';
  }
  return 'X';
}

/**
 * Interactive Probe Tooltip Component.
 *
 * @param props - Schematic nodes, edges, sim solver outputs, and VDD reference
 * @returns Floating glassmorphic HUD tooltip
 */
export function InteractiveProbeTooltip({
  nodes,
  edges,
  simOutputs,
  vdd = DEFAULT_VDD,
  visible = true,
}: InteractiveProbeTooltipProps): React.ReactElement | null {
  const [probeState, setProbeState] = useState<ProbedElectricalState | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isVisible, setIsVisible] = useState(false);

  // History buffer for sparkline waveforms keyed by target ID
  const historyMapRef = useRef<Map<string, number[]>>(new Map());
  const activeTargetRef = useRef<string | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  // Detect and sample live electrical parameters for a wire/terminal/node
  const resolveElectricalState = (
    targetType: 'wire' | 'terminal' | 'node',
    targetId: string,
    extraId?: string
  ): ProbedElectricalState | null => {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    if (targetType === 'wire') {
      const edge = edges.find((e) => e.id === targetId);
      if (!edge) return null;

      const srcNode = nodeMap.get(edge.source);
      const tgtNode = nodeMap.get(edge.target);
      const srcOut = simOutputs?.get(edge.source);

      // Voltage calculation
      let v = 0;
      if (srcNode?.type === 'vsource') {
        v = srcNode.data.param ?? vdd;
      } else if (srcNode?.type === 'ground') {
        v = 0;
      } else if (srcNode?.data.voltageDrop !== undefined) {
        v = srcNode.data.voltageDrop;
      } else if (srcNode?.data.value === 1) {
        v = vdd;
      } else if (srcNode?.data.value === 0) {
        v = 0;
      }

      // Current calculation
      let i = srcOut?.current ?? srcNode?.data.current ?? tgtNode?.data.current ?? 0;
      if (i === 0 && (srcNode?.data.value === 1 || tgtNode?.data.value === 1)) {
        i = 0.005; // 5mA nominal digital flow
      }

      const logic = deriveLogicState(srcNode?.data.value, v);

      // Get or update sample history
      const histKey = `wire:${edge.id}`;
      let hist = historyMapRef.current.get(histKey);
      if (!hist || hist.length === 0) {
        hist = Array(HISTORY_SAMPLE_COUNT).fill(v);
      } else {
        hist = [...hist.slice(1), v];
      }
      historyMapRef.current.set(histKey, hist);

      return {
        targetType: 'wire',
        targetId: edge.id,
        label: `Wire: ${srcNode?.data.label ?? edge.source} ➔ ${tgtNode?.data.label ?? edge.target}`,
        subLabel: `Net e${edge.source}-${edge.target}${edge.targetHandle ? ` (pin ${edge.targetHandle.toUpperCase()})` : ''}`,
        voltage: v,
        current: i,
        logicState: logic,
        history: hist,
        vdd,
        simWarning: srcNode?.data.simWarning ?? tgtNode?.data.simWarning,
      };
    }

    if (targetType === 'terminal' || targetType === 'node') {
      const node = nodeMap.get(targetId);
      if (!node) return null;

      const handle = extraId || (targetType === 'terminal' ? 'terminal' : 'main');
      const out = simOutputs?.get(node.id);

      let v = 0;
      let i = out?.current ?? node.data.current ?? 0;
      let region: OperatingRegion | undefined = out?.region ?? node.data.region;

      if (node.type === 'vsource') {
        v = handle === 'neg' ? 0 : (node.data.param ?? vdd);
      } else if (node.type === 'ground') {
        v = 0;
      } else if (node.type === 'nmos' || node.type === 'pmos') {
        v = node.data.voltageDrop ?? (out?.voltageDrop ?? 0);
        region = node.data.region ?? out?.region ?? 'Saturation';
      } else if (node.data.voltageDrop !== undefined) {
        v = node.data.voltageDrop;
      } else if (node.data.value === 1) {
        v = vdd;
      } else if (node.data.value === 0) {
        v = 0;
      }

      const logic = deriveLogicState(node.data.value, v);

      const histKey = `term:${node.id}:${handle}`;
      let hist = historyMapRef.current.get(histKey);
      if (!hist || hist.length === 0) {
        hist = Array(HISTORY_SAMPLE_COUNT).fill(v);
      } else {
        hist = [...hist.slice(1), v];
      }
      historyMapRef.current.set(histKey, hist);

      return {
        targetType,
        targetId: node.id,
        label: `${targetType === 'terminal' ? 'Terminal' : 'Node'}: ${node.data.label}`,
        subLabel: `${node.type?.toUpperCase()} [Port: ${handle.toUpperCase()}]`,
        voltage: v,
        current: i,
        logicState: logic,
        operatingRegion: region,
        history: hist,
        vdd,
        resistance: node.type === 'resistor' ? node.data.param : undefined,
        simWarning: node.data.simWarning,
      };
    }

    return null;
  };

  // Attach global DOM pointer listeners on canvas elements
  useEffect(() => {
    if (!visible) return;

    const handlePointerMove = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | SVGElement | null;
      if (!target) return;

      // 1. Check for wire / edge hover
      const edgeEl = target.closest('.react-flow__edge');
      const edgePathEl = target.closest('.react-flow__edge-path');

      if (edgeEl || edgePathEl) {
        const edgeId =
          edgeEl?.getAttribute('data-id') ||
          edgeEl?.getAttribute('id') ||
          edgePathEl?.getAttribute('id')?.replace(/^edge-/, '') ||
          '';

        if (edgeId) {
          activeTargetRef.current = `wire:${edgeId}`;
          const state = resolveElectricalState('wire', edgeId);
          if (state) {
            setProbeState(state);
            setPos({ x: e.clientX, y: e.clientY });
            setIsVisible(true);
            return;
          }
        }
      }

      // 2. Check for handle / terminal hover
      const handleEl = target.closest('.react-flow__handle');
      if (handleEl) {
        const nodeId = handleEl.getAttribute('data-nodeid') || handleEl.closest('.react-flow__node')?.getAttribute('data-id') || '';
        const handleId = handleEl.getAttribute('data-handleid') || '';

        if (nodeId) {
          activeTargetRef.current = `term:${nodeId}:${handleId}`;
          const state = resolveElectricalState('terminal', nodeId, handleId);
          if (state) {
            setProbeState(state);
            setPos({ x: e.clientX, y: e.clientY });
            setIsVisible(true);
            return;
          }
        }
      }

      // 3. Check for node body hover
      const nodeEl = target.closest('.react-flow__node');
      if (nodeEl && !target.closest('.nodrag') && !target.closest('input') && !target.closest('button')) {
        const nodeId = nodeEl.getAttribute('data-id') || '';
        if (nodeId) {
          activeTargetRef.current = `node:${nodeId}`;
          const state = resolveElectricalState('node', nodeId);
          if (state) {
            setProbeState(state);
            setPos({ x: e.clientX, y: e.clientY });
            setIsVisible(true);
            return;
          }
        }
      }

      // If mouse moved outside probes
      activeTargetRef.current = null;
      setIsVisible(false);
    };

    const handleMouseLeave = (): void => {
      activeTargetRef.current = null;
      setIsVisible(false);
    };

    window.addEventListener('mousemove', handlePointerMove);
    document.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
    };
  });

  // Continuous waveform sampling clock for active probe
  useEffect(() => {
    if (!isVisible || !probeState) return;

    const interval = setInterval(() => {
      if (!activeTargetRef.current || !probeState) return;

      const [kind, id1, id2] = activeTargetRef.current.split(':');
      let targetType: 'wire' | 'terminal' | 'node' = 'wire';
      if (kind === 'term') targetType = 'terminal';
      if (kind === 'node') targetType = 'node';

      const updated = resolveElectricalState(targetType, id1, id2);
      if (updated) {
        setProbeState(updated);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isVisible, probeState, nodes, edges, simOutputs, vdd]);

  if (!visible || !probeState) return null;

  // Viewport edge collision prevention
  const width = 260;
  const height = 240;
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;

  let left = pos.x + 16;
  let top = pos.y + 16;

  if (left + width > screenW - 16) {
    left = pos.x - width - 16;
  }
  if (top + height > screenH - 16) {
    top = pos.y - height - 16;
  }

  // Calculate voltage gauge percentage
  const gaugePercent = Math.min(100, Math.max(0, (probeState.voltage / (probeState.vdd || DEFAULT_VDD)) * 100));

  // Build SVG Sparkline Waveform Path
  const svgWidth = 220;
  const svgHeight = 36;
  const padding = 4;
  const samples = probeState.history.length > 0 ? probeState.history : [probeState.voltage];

  const maxV = Math.max(probeState.vdd || DEFAULT_VDD, ...samples, 0.1);
  const minV = 0;

  const points = samples.map((val, idx) => {
    const x = padding + (idx / Math.max(1, samples.length - 1)) * (svgWidth - padding * 2);
    const normalized = (val - minV) / (maxV - minV);
    const y = svgHeight - padding - normalized * (svgHeight - padding * 2);
    return { x, y };
  });

  const pathD = points.reduce((acc, pt, idx) => `${acc} ${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`, '');
  const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)},${svgHeight} L ${points[0].x.toFixed(1)},${svgHeight} Z`;
  const lastPt = points[points.length - 1] || { x: svgWidth - padding, y: svgHeight / 2 };

  return (
    <div
      ref={tooltipRef}
      className={`interactive-probe-tooltip ${isVisible ? 'probe-tooltip--visible' : 'probe-tooltip--hidden'}`}
      style={{ left: `${left}px`, top: `${top}px` }}
      data-testid="interactive-probe-tooltip"
      role="tooltip"
    >
      {/* Header */}
      <div className="probe-header">
        <div className="probe-title-group">
          <div className="probe-badge-row">
            <span className="probe-target-icon">⚡</span>
            <span className="probe-target-title">{probeState.label}</span>
          </div>
          {probeState.subLabel && <span className="probe-sublabel">{probeState.subLabel}</span>}
        </div>
        <span
          className={`probe-logic-badge probe-logic--${probeState.logicState}`}
          data-testid="probe-logic"
          title={`Digital Logic Level: ${probeState.logicState}`}
        >
          {probeState.logicState === '1' ? 'HIGH (1)' : probeState.logicState === '0' ? 'LOW (0)' : probeState.logicState === 'Z' ? 'HI-Z' : 'UNDEF (X)'}
        </span>
      </div>

      {/* Numerical Readings Grid */}
      <div className="probe-readings-grid">
        <div className="probe-metric-card">
          <div className="probe-metric-label">
            <span>Voltage V(t)</span>
          </div>
          <div className="probe-metric-value probe-metric-value--volts" data-testid="probe-voltage">
            {formatProbeVoltage(probeState.voltage)}
          </div>
        </div>

        <div className="probe-metric-card">
          <div className="probe-metric-label">
            <span>Current I(t)</span>
          </div>
          <div className="probe-metric-value probe-metric-value--amps" data-testid="probe-current">
            {formatProbeCurrent(probeState.current)}
          </div>
        </div>
      </div>

      {/* Voltage Gauge Progress Bar */}
      <div className="probe-gauge-container">
        <div className="probe-gauge-header">
          <span>0V</span>
          <span>VDD ({probeState.vdd?.toFixed(1) ?? '5.0'}V)</span>
        </div>
        <div className="probe-gauge-track">
          <div
            className="probe-gauge-fill"
            style={{ width: `${gaugePercent}%` }}
            data-testid="probe-gauge-fill"
          />
        </div>
      </div>

      {/* Mini SVG Sparkline Waveform */}
      <div className="probe-waveform-container" data-testid="probe-sparkline">
        <div className="probe-waveform-header">
          <span>Live Waveform (20 samples)</span>
          <span>{formatProbeVoltage(probeState.voltage)}</span>
        </div>
        <svg
          className="probe-waveform-svg"
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="sparkline-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00F0FF" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#00F0FF" stopOpacity="0.0" />
            </linearGradient>
            <filter id="glow-wave" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Reference Grid lines */}
          <line x1="0" y1={svgHeight / 2} x2={svgWidth} y2={svgHeight / 2} stroke="rgba(255,255,255,0.08)" strokeDasharray="3,3" />
          <line x1="0" y1={svgHeight - padding} x2={svgWidth} y2={svgHeight - padding} stroke="rgba(255,255,255,0.12)" />

          {/* Waveform Fill & Stroke */}
          <path d={areaD} fill="url(#sparkline-grad)" />
          <path
            d={pathD}
            fill="none"
            stroke="#00F0FF"
            strokeWidth="1.8"
            filter="url(#glow-wave)"
          />

          {/* Pulsing latest point */}
          <circle
            cx={lastPt.x}
            cy={lastPt.y}
            r="3"
            fill="#4ade80"
            className="sparkline-pulse-dot"
          />
        </svg>
      </div>

      {/* Diagnostics / Transistor Region Footer */}
      {(probeState.operatingRegion || probeState.simWarning || probeState.resistance) && (
        <div className="probe-footer">
          {probeState.operatingRegion && (
            <span
              className={`probe-region-pill ${
                probeState.operatingRegion === 'Saturation'
                  ? 'probe-region--sat'
                  : probeState.operatingRegion === 'Triode'
                  ? 'probe-region--triode'
                  : 'probe-region--cutoff'
              }`}
            >
              Region: {probeState.operatingRegion}
            </span>
          )}
          {probeState.resistance !== undefined && (
            <span className="probe-region-pill">R = {probeState.resistance} Ω</span>
          )}
          {probeState.simWarning && (
            <span className="probe-warning-text" title={probeState.simWarning}>
              ⚠️ {probeState.simWarning}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default InteractiveProbeTooltip;
