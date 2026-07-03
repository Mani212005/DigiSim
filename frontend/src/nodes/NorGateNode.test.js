/**
 * @file NorGateNode.test.js
 * @description Render tests for the NOR gate node component — verifies the label
 * renders and the schematic glows (gate-node--on) exactly when the output is 1.
 */

import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import NorGateNode from './NorGateNode';

const wrap = (ui) => render(<ReactFlowProvider>{ui}</ReactFlowProvider>);

test('renders the gate label', () => {
  wrap(<NorGateNode data={{ label: 'NOR Gate', value: 0 }} />);
  expect(screen.getByText('NOR Gate')).toBeInTheDocument();
});

test('stays idle (no glow class) when value is 0', () => {
  const { container } = wrap(<NorGateNode data={{ label: 'NOR Gate', value: 0 }} />);
  expect(container.querySelector('.gate-node')).not.toHaveClass('gate-node--on');
});

test('glows (gate-node--on) when value is 1', () => {
  const { container } = wrap(<NorGateNode data={{ label: 'NOR Gate', value: 1 }} />);
  expect(container.querySelector('.gate-node')).toHaveClass('gate-node--on');
});
