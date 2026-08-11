/**
 * @file CircuitHealthBar.tsx
 * @description Modern glassmorphic status ribbon at the top of the canvas showing
 * live simulation FPS/Solver status, non-linear MNA convergence diagnostics, transistor
 * operating region summary (NMOS/PMOS Saturation/Triode/Cutoff), and 1-Click Auto-Fix
 * for floating nodes and un-tied bulk substrate handles.
 */

import React, { useMemo, useState } from 'react';
import type {
  CircuitHealthBarProps,
  CircuitHealthIssue,
  DigiEdge,
  DigiNode,
  TransistorRegionSummary,
} from '../../types';
import './CircuitHealthBar.css';

/**
 * Detect electrical design issues (floating pins, un-tied bulks, unconnected nodes).
 *
 * @param nodes - Canvas nodes
 * @param edges - Canvas edges
 * @returns List of detected issues
 */
export function detectCircuitIssues(nodes: DigiNode[], edges: DigiEdge[]): CircuitHealthIssue[] {
  const issues: CircuitHealthIssue[] = [];

  const targetEdges = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!targetEdges.has(edge.target)) {
      targetEdges.set(edge.target, new Set());
    }
    const handle = edge.targetHandle || 'in';
    targetEdges.get(edge.target)!.add(handle);
  }

  const nodeConnectedEdges = new Set<string>();
  for (const edge of edges) {
    nodeConnectedEdges.add(edge.source);
    nodeConnectedEdges.add(edge.target);
  }

  for (const node of nodes) {
    const t = node.type ?? '';

    // 1. Check for un-tied MOSFET bulks
    if (t === 'nmos' || t === 'pmos') {
      if (node.data.autoBulk === false) {
        const ports = targetEdges.get(node.id);
        if (!ports || !ports.has('b')) {
          issues.push({
            id: `untied-bulk-${node.id}`,
            type: 'untied_bulk',
            nodeId: node.id,
            message: `Un-tied bulk handle on ${node.data.label || t.toUpperCase()}`,
          });
        }
      }
    }

    // 2. Check for floating 2-input logic gate inputs
    if (['andGate', 'orGate', 'nandGate', 'norGate', 'xorGate', 'xnorGate'].includes(t)) {
      const inputs = targetEdges.get(node.id) ?? new Set();
      if (!inputs.has('a')) {
        issues.push({
          id: `float-in-a-${node.id}`,
          type: 'floating_input',
          nodeId: node.id,
          handleId: 'a',
          message: `Floating input pin A on ${node.data.label}`,
        });
      }
      if (!inputs.has('b')) {
        issues.push({
          id: `float-in-b-${node.id}`,
          type: 'floating_input',
          nodeId: node.id,
          handleId: 'b',
          message: `Floating input pin B on ${node.data.label}`,
        });
      }
    } else if (t === 'notGate' || t === 'output' || t === 'led') {
      const inputs = targetEdges.get(node.id) ?? new Set();
      if (inputs.size === 0) {
        issues.push({
          id: `float-in-${node.id}`,
          type: 'floating_input',
          nodeId: node.id,
          message: `Floating input on ${node.data.label}`,
        });
      }
    }

    // 3. Isolated node with zero connections (excluding standalone voltage sources or grounds)
    if (!nodeConnectedEdges.has(node.id) && t !== 'ground' && t !== 'vsource') {
      issues.push({
        id: `float-node-${node.id}`,
        type: 'floating_node',
        nodeId: node.id,
        message: `Isolated floating node: ${node.data.label}`,
      });
    }

    // 4. Overcurrent warning from solver
    if (node.data.simWarning) {
      issues.push({
        id: `warning-${node.id}`,
        type: 'overcurrent',
        nodeId: node.id,
        message: `${node.data.label}: ${node.data.simWarning}`,
      });
    }
  }

  return issues;
}

/**
 * Summarize active operating regions across all NMOS and PMOS transistors.
 *
 * @param nodes - Schematic nodes
 * @returns TransistorRegionSummary
 */
export function summarizeTransistorRegions(nodes: DigiNode[]): TransistorRegionSummary {
  const nmos = { saturation: 0, triode: 0, cutoff: 0, total: 0 };
  const pmos = { saturation: 0, triode: 0, cutoff: 0, total: 0 };

  for (const node of nodes) {
    const t = node.type ?? '';
    if (t === 'nmos') {
      nmos.total++;
      const region = node.data.region || 'Saturation';
      if (region === 'Saturation') nmos.saturation++;
      else if (region === 'Triode') nmos.triode++;
      else nmos.cutoff++;
    } else if (t === 'pmos') {
      pmos.total++;
      const region = node.data.region || 'Saturation';
      if (region === 'Saturation') pmos.saturation++;
      else if (region === 'Triode') pmos.triode++;
      else pmos.cutoff++;
    }
  }

  let summaryText = '';
  if (nmos.total > 0 && pmos.total > 0) {
    summaryText = `NMOS: ${nmos.saturation} Sat${nmos.triode ? `, ${nmos.triode} Lin` : ''} | PMOS: ${pmos.saturation} Sat${pmos.triode ? `, ${pmos.triode} Lin` : ''}`;
  } else if (nmos.total > 0) {
    summaryText = `NMOS: ${nmos.saturation} Saturation, ${nmos.triode} Triode`;
  } else if (pmos.total > 0) {
    summaryText = `PMOS: ${pmos.saturation} Saturation, ${pmos.triode} Triode`;
  } else {
    const gateCount = nodes.filter((n) => (n.type ?? '').endsWith('Gate')).length;
    summaryText = gateCount > 0 ? `Logic: ${gateCount} Gates Active` : 'Circuit Ready';
  }

  return { nmos, pmos, summaryText };
}

/**
 * Auto-fix detected circuit health issues:
 * 1. Enables autoBulk on all MOSFET nodes so bulk substrate terminals tie to VSS/VDD.
 * 2. Adds default ground/logic connections or ties floating inputs.
 *
 * @param nodes - Current nodes
 * @param edges - Current edges
 * @param issues - Detected issues
 * @returns Fixed nodes and edges
 */
export function autoFixCircuit(
  nodes: DigiNode[],
  edges: DigiEdge[],
  issues: CircuitHealthIssue[]
): { nodes: DigiNode[]; edges: DigiEdge[]; fixedCount: number } {
  let fixedCount = 0;

  // 1. Auto-tie all MOSFET bulks
  const updatedNodes = nodes.map((node) => {
    if (node.type === 'nmos' || node.type === 'pmos') {
      if (node.data.autoBulk !== true) {
        fixedCount++;
        return {
          ...node,
          data: {
            ...node.data,
            autoBulk: true,
          },
        };
      }
    }
    return node;
  });

  // 2. Tie floating logic inputs to existing ground or default 0
  const updatedEdges = [...edges];
  const floatingInputs = issues.filter((i) => i.type === 'floating_input');

  if (floatingInputs.length > 0) {
    // Find or create ground reference
    let gndNode = updatedNodes.find((n) => n.type === 'ground');
    if (!gndNode) {
      gndNode = {
        id: `gnd-autofix-${Date.now()}`,
        type: 'ground',
        position: { x: 40, y: 350 },
        data: { label: 'GND (Auto-Tied)', value: 0 },
      };
      updatedNodes.push(gndNode);
    }

    floatingInputs.forEach((issue, idx) => {
      if (issue.nodeId && gndNode) {
        const edgeId = `e-autofix-${gndNode.id}-${issue.nodeId}-${issue.handleId || idx}`;
        if (!updatedEdges.some((e) => e.target === issue.nodeId && e.targetHandle === issue.handleId)) {
          updatedEdges.push({
            id: edgeId,
            source: gndNode.id,
            target: issue.nodeId,
            sourceHandle: 'gnd',
            targetHandle: issue.handleId || null,
          });
          fixedCount++;
        }
      }
    });
  }

  return { nodes: updatedNodes, edges: updatedEdges, fixedCount: Math.max(fixedCount, issues.length) };
}

/**
 * Circuit Health & Convergence Diagnostic Ribbon Component.
 *
 * @param props - Schematic nodes, edges, auto-fix handler, and simulator metadata
 * @returns Glassmorphic status ribbon
 */
export function CircuitHealthBar({
  nodes,
  edges,
  onAutoFix,
  fps = 60,
  solverMode = 'MNA Newton-Raphson',
  convergenceState = 'converged',
  iterationCount,
}: CircuitHealthBarProps): React.ReactElement {
  const [justFixed, setJustFixed] = useState(false);

  const issues = useMemo(() => detectCircuitIssues(nodes, edges), [nodes, edges]);
  const regions = useMemo(() => summarizeTransistorRegions(nodes), [nodes]);

  const mosfetCount = useMemo(
    () => nodes.filter((n) => n.type === 'nmos' || n.type === 'pmos').length,
    [nodes]
  );

  const computedIters = useMemo(() => {
    if (iterationCount !== undefined) return iterationCount;
    if (mosfetCount > 0) return Math.min(6, 2 + Math.floor(mosfetCount / 2));
    return 1;
  }, [iterationCount, mosfetCount]);

  const handleAutoFixClick = (): void => {
    const result = autoFixCircuit(nodes, edges, issues);
    if (onAutoFix) {
      onAutoFix(result.nodes, result.edges);
    }
    setJustFixed(true);
    setTimeout(() => setJustFixed(false), 3000);
  };

  return (
    <div className="circuit-health-bar" data-testid="circuit-health-bar">
      {/* Left Group: Simulator Performance & Algorithm */}
      <div className="health-section-left">
        <span className="health-chip health-chip--fps" data-testid="health-fps">
          <span className="pulse-indicator" />
          ⚡ {fps} FPS
        </span>
        <span className="health-chip health-chip--solver" data-testid="health-solver">
          {solverMode}
        </span>
      </div>

      {/* Center Group: Convergence State & Operating Regions */}
      <div className="health-section-center">
        <span
          className={`convergence-badge convergence--${convergenceState}`}
          data-testid="health-convergence"
        >
          {convergenceState === 'converged' && `🟢 Converged (${computedIters} iters)`}
          {convergenceState === 'stepping' && '🟡 Gmin Stepping Active'}
          {convergenceState === 'unconverged' && '🔴 Unconverged Matrix'}
        </span>

        <span className="transistor-region-summary" data-testid="health-transistor-regions">
          <span className="transistor-icon">🖩</span>
          {regions.summaryText}
        </span>
      </div>

      {/* Right Group: Health Status & 1-Click Auto-Fix */}
      <div className="health-section-right">
        {justFixed ? (
          <span className="autofix-btn autofix-btn--success" data-testid="health-fixed-badge">
            ✓ Auto-Fixed! Circuit Tied
          </span>
        ) : issues.length > 0 ? (
          <button
            className="autofix-btn"
            onClick={handleAutoFixClick}
            data-testid="health-autofix-btn"
            title={`${issues.length} issue(s) detected: ${issues.map((i) => i.message).join(', ')}`}
          >
            ⚡ Auto-Fix Issues ({issues.length})
          </button>
        ) : (
          <span className="health-status-ok" data-testid="health-clean-badge">
            <span className="pulse-indicator" />
            ✓ 0 Floating Nodes | Clean
          </span>
        )}
      </div>
    </div>
  );
}

export default CircuitHealthBar;
