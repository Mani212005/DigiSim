/**
 * @file CircuitHealthBar.test.tsx
 * @description Unit & integration tests for CircuitHealthBar: convergence status,
 * transistor operating region tallying, issue detection, and 1-click auto-repair.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  CircuitHealthBar,
  autoFixCircuit,
  detectCircuitIssues,
  summarizeTransistorRegions,
} from './CircuitHealthBar';
import type { DigiEdge, DigiNode } from '../../types';

describe('Circuit Health Diagnostic Logic', () => {
  it('detects un-tied MOSFET bulks when autoBulk is false', () => {
    const nodes: DigiNode[] = [
      { id: 'm1', position: { x: 0, y: 0 }, type: 'nmos', data: { label: 'NMOS1', value: 0, autoBulk: false } },
    ];
    const edges: DigiEdge[] = [];

    const issues = detectCircuitIssues(nodes, edges);
    expect(issues.some((i) => i.type === 'untied_bulk')).toBe(true);
  });

  it('detects floating inputs on logic gates', () => {
    const nodes: DigiNode[] = [
      { id: 'g1', position: { x: 0, y: 0 }, type: 'andGate', data: { label: 'AND1', value: 0 } },
    ];
    const edges: DigiEdge[] = [];

    const issues = detectCircuitIssues(nodes, edges);
    expect(issues.some((i) => i.type === 'floating_input' && i.handleId === 'a')).toBe(true);
    expect(issues.some((i) => i.type === 'floating_input' && i.handleId === 'b')).toBe(true);
  });

  it('summarizes transistor operating regions accurately', () => {
    const nodes: DigiNode[] = [
      { id: 'n1', position: { x: 0, y: 0 }, type: 'nmos', data: { label: 'N1', value: 0, region: 'Saturation' } },
      { id: 'n2', position: { x: 0, y: 0 }, type: 'nmos', data: { label: 'N2', value: 0, region: 'Triode' } },
      { id: 'p1', position: { x: 0, y: 0 }, type: 'pmos', data: { label: 'P1', value: 0, region: 'Saturation' } },
      { id: 'p2', position: { x: 0, y: 0 }, type: 'pmos', data: { label: 'P2', value: 0, region: 'Saturation' } },
    ];

    const summary = summarizeTransistorRegions(nodes);
    expect(summary.nmos.saturation).toBe(1);
    expect(summary.nmos.triode).toBe(1);
    expect(summary.pmos.saturation).toBe(2);
    expect(summary.summaryText).toContain('NMOS: 1 Sat, 1 Lin | PMOS: 2 Sat');
  });

  it('auto-fixes un-tied bulks and ties floating inputs to GND', () => {
    const nodes: DigiNode[] = [
      { id: 'm1', position: { x: 0, y: 0 }, type: 'nmos', data: { label: 'NMOS1', value: 0, autoBulk: false } },
      { id: 'g1', position: { x: 0, y: 0 }, type: 'andGate', data: { label: 'AND1', value: 0 } },
    ];
    const edges: DigiEdge[] = [];

    const issues = detectCircuitIssues(nodes, edges);
    const fixed = autoFixCircuit(nodes, edges, issues);

    expect(fixed.nodes.find((n) => n.id === 'm1')?.data.autoBulk).toBe(true);
    expect(fixed.nodes.some((n) => n.type === 'ground')).toBe(true);
    expect(fixed.edges.length).toBeGreaterThan(0);
  });
});

describe('CircuitHealthBar Component Rendering', () => {
  it('renders FPS, solver status, convergence state, and clean health badge', () => {
    const cleanNodes: DigiNode[] = [
      { id: 'in1', position: { x: 0, y: 0 }, type: 'input', data: { label: 'A', value: 1 } },
      { id: 'in2', position: { x: 0, y: 100 }, type: 'input', data: { label: 'B', value: 0 } },
      { id: 'and1', position: { x: 200, y: 50 }, type: 'andGate', data: { label: 'AND1', value: 0 } },
    ];
    const cleanEdges: DigiEdge[] = [
      { id: 'e1', source: 'in1', target: 'and1', targetHandle: 'a' },
      { id: 'e2', source: 'in2', target: 'and1', targetHandle: 'b' },
    ];

    render(
      <CircuitHealthBar
        nodes={cleanNodes}
        edges={cleanEdges}
        fps={60}
        solverMode="MNA Newton-Raphson"
        convergenceState="converged"
      />
    );

    expect(screen.getByTestId('health-fps')).toHaveTextContent(/60 FPS/i);
    expect(screen.getByTestId('health-solver')).toHaveTextContent(/MNA Newton-Raphson/i);
    expect(screen.getByTestId('health-convergence')).toHaveTextContent(/Converged/i);
    expect(screen.getByTestId('health-clean-badge')).toHaveTextContent(/0 Floating Nodes/i);
  });

  it('renders Auto-Fix button when issues are detected and triggers onAutoFix callback on click', () => {
    const mockOnAutoFix = jest.fn();
    const issueNodes: DigiNode[] = [
      { id: 'm1', position: { x: 0, y: 0 }, type: 'nmos', data: { label: 'NMOS1', value: 0, autoBulk: false } },
    ];
    const issueEdges: DigiEdge[] = [];

    render(
      <CircuitHealthBar
        nodes={issueNodes}
        edges={issueEdges}
        onAutoFix={mockOnAutoFix}
      />
    );

    const autoFixBtn = screen.getByTestId('health-autofix-btn');
    expect(autoFixBtn).toBeInTheDocument();
    expect(autoFixBtn).toHaveTextContent(/Auto-Fix Issues/i);

    fireEvent.click(autoFixBtn);
    expect(mockOnAutoFix).toHaveBeenCalled();
    expect(screen.getByTestId('health-fixed-badge')).toHaveTextContent(/Auto-Fixed/i);
  });
});
