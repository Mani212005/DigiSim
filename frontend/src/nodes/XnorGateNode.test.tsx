/**
 * @file XnorGateNode.test.tsx
 * @description Render tests for the XNOR gate node component — verifies the label
 * renders and the schematic glows (gate-node--on) exactly when the output is 1.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import XnorGateNode from './XnorGateNode';
import type { NodeData } from '../types';

const wrap = (ui: React.ReactElement) =>
  render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
const data = (value: number): NodeData => ({ label: 'XNOR Gate', value });

test('renders the gate label', () => {
  wrap(<XnorGateNode data={data(0)} />);
  expect(screen.getByText('XNOR Gate')).toBeInTheDocument();
});

test('stays idle (no glow class) when value is 0', () => {
  const { container } = wrap(<XnorGateNode data={data(0)} />);
  expect(container.querySelector('.gate-node')).not.toHaveClass('gate-node--on');
});

test('glows (gate-node--on) when value is 1', () => {
  const { container } = wrap(<XnorGateNode data={data(1)} />);
  expect(container.querySelector('.gate-node')).toHaveClass('gate-node--on');
});
