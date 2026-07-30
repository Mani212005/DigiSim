/**
 * @file NandGateNode.test.tsx
 * @description Render tests for the NAND gate node component — verifies the label
 * renders and the schematic glows (active) exactly when the output is 1.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import NandGateNode from './NandGateNode';
import type { NodeData } from '../types';

const wrap = (ui: React.ReactElement) =>
  render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
const data = (value: number): NodeData => ({ label: 'NAND Gate', value });

test('renders the gate label', () => {
  wrap(<NandGateNode data={data(0)} />);
  expect(screen.getByText('NAND Gate')).toBeInTheDocument();
});

test('stays idle (no glow class) when value is 0', () => {
  const { container } = wrap(<NandGateNode data={data(0)} />);
  expect(container.querySelector('.node-card')).not.toHaveClass('active');
});

test('glows (active) when value is 1', () => {
  const { container } = wrap(<NandGateNode data={data(1)} />);
  expect(container.querySelector('.node-card')).toHaveClass('active');
});
