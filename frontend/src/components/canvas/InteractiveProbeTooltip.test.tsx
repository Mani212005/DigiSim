/**
 * @file InteractiveProbeTooltip.test.tsx
 * @description Unit & integration tests for InteractiveProbeTooltip: live V/I gauges,
 * logic badges, mini SVG sparklines, current formatting, and hover detection.
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  InteractiveProbeTooltip,
  deriveLogicState,
  formatProbeCurrent,
  formatProbeVoltage,
} from './InteractiveProbeTooltip';
import type { DigiEdge, DigiNode } from '../../types';

describe('InteractiveProbeTooltip utility functions', () => {
  it('formats electrical currents across uA, mA, and A ranges', () => {
    expect(formatProbeCurrent(0)).toBe('0.00 µA');
    expect(formatProbeCurrent(0.0000005)).toBe('0.50 µA');
    expect(formatProbeCurrent(0.00045)).toBe('450.00 µA');
    expect(formatProbeCurrent(0.0125)).toBe('12.50 mA');
    expect(formatProbeCurrent(1.85)).toBe('1.850 A');
  });

  it('formats electrical voltages accurately', () => {
    expect(formatProbeVoltage(5)).toBe('5.00 V');
    expect(formatProbeVoltage(3.3)).toBe('3.30 V');
    expect(formatProbeVoltage(0)).toBe('0.00 V');
    expect(formatProbeVoltage(1.2345)).toBe('1.23 V');
  });

  it('derives digital logic states from values and voltage levels', () => {
    expect(deriveLogicState(1)).toBe('1');
    expect(deriveLogicState('1')).toBe('1');
    expect(deriveLogicState(0)).toBe('0');
    expect(deriveLogicState('0')).toBe('0');
    expect(deriveLogicState('Z')).toBe('Z');
    expect(deriveLogicState('X')).toBe('X');
    expect(deriveLogicState(undefined, 3.3)).toBe('1');
    expect(deriveLogicState(undefined, 0.2)).toBe('0');
    expect(deriveLogicState(undefined, 1.4)).toBe('X');
  });
});

describe('InteractiveProbeTooltip Component Rendering', () => {
  const mockNodes: DigiNode[] = [
    { id: 'n1', position: { x: 0, y: 0 }, type: 'input', data: { label: 'Input A', value: 1 } },
    { id: 'n2', position: { x: 200, y: 0 }, type: 'resistor', data: { label: 'R1', value: 0, param: 1000, current: 0.005, voltageDrop: 5 } },
    { id: 'n3', position: { x: 400, y: 0 }, type: 'nmos', data: { label: 'M1', value: 0, region: 'Saturation', voltageDrop: 1.8, current: 0.002 } },
  ];

  const mockEdges: DigiEdge[] = [
    { id: 'e1-2', source: 'n1', target: 'n2', sourceHandle: 'out', targetHandle: 'a' },
    { id: 'e2-3', source: 'n2', target: 'n3', sourceHandle: 'b', targetHandle: 'd' },
  ];

  it('renders probe tooltip with hidden state initially when visible prop is true', () => {
    render(<InteractiveProbeTooltip nodes={mockNodes} edges={mockEdges} vdd={5.0} />);
    // When no element is hovered yet, tooltip is not active
    expect(screen.queryByTestId('interactive-probe-tooltip')).not.toBeInTheDocument();
  });

  it('activates tooltip on wire hover and displays electrical gauge, current, and sparkline', () => {
    const { container } = render(
      <div>
        <svg>
          <g className="react-flow__edge" data-id="e1-2">
            <path className="react-flow__edge-path" id="edge-e1-2" d="M 0 0 L 200 0" />
          </g>
        </svg>
        <InteractiveProbeTooltip nodes={mockNodes} edges={mockEdges} vdd={5.0} />
      </div>
    );

    const edgePath = container.querySelector('.react-flow__edge-path')!;
    expect(edgePath).toBeTruthy();

    act(() => {
      fireEvent.mouseMove(edgePath, { clientX: 100, clientY: 100 });
    });

    const tooltip = screen.getByTestId('interactive-probe-tooltip');
    expect(tooltip).toBeInTheDocument();
    expect(screen.getByText(/Wire: Input A ➔ R1/i)).toBeInTheDocument();
    expect(screen.getByTestId('probe-voltage')).toHaveTextContent('5.00 V');
    expect(screen.getByTestId('probe-current')).toHaveTextContent('5.00 mA');
    expect(screen.getByTestId('probe-logic')).toHaveTextContent(/HIGH/i);
    expect(screen.getByTestId('probe-sparkline')).toBeInTheDocument();
    expect(screen.getByTestId('probe-gauge-fill')).toBeInTheDocument();
  });

  it('activates tooltip on handle/terminal hover with MOSFET operating region', () => {
    const { container } = render(
      <div>
        <div className="react-flow__node" data-id="n3">
          <div className="react-flow__handle" data-nodeid="n3" data-handleid="d" />
        </div>
        <InteractiveProbeTooltip nodes={mockNodes} edges={mockEdges} vdd={3.3} />
      </div>
    );

    const handle = container.querySelector('.react-flow__handle')!;
    expect(handle).toBeTruthy();

    act(() => {
      fireEvent.mouseMove(handle, { clientX: 150, clientY: 200 });
    });

    expect(screen.getByTestId('interactive-probe-tooltip')).toBeInTheDocument();
    expect(screen.getByText(/Terminal: M1/i)).toBeInTheDocument();
    expect(screen.getByText(/Region: Saturation/i)).toBeInTheDocument();
    expect(screen.getByTestId('probe-voltage')).toHaveTextContent('1.80 V');
    expect(screen.getByTestId('probe-current')).toHaveTextContent('2.00 mA');
  });
});
