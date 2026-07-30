/**
 * @file NotGateNode.test.tsx
 * @description Render tests for the NOT gate node component — verifies the label
 * renders and the schematic glows (active) exactly when the output is 1.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import NotGateNode from './NotGateNode';
import type { NodeData } from '../types';

const wrap = (ui: React.ReactElement) =>
  render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
const data = (value: number): NodeData => ({ label: 'NOT Gate', value });

test('renders the gate label', () => {
  wrap(<NotGateNode data={data(0)} />);
  expect(screen.getByText('NOT Gate')).toBeInTheDocument();
});

test('stays idle (no glow class) when value is 0', () => {
  const { container } = wrap(<NotGateNode data={data(0)} />);
  expect(container.querySelector('.node-card')).not.toHaveClass('active');
});

test('glows (active) when value is 1', () => {
  const { container } = wrap(<NotGateNode data={data(1)} />);
  expect(container.querySelector('.node-card')).toHaveClass('active');
});
