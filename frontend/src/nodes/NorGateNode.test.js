/**
 * @file NorGateNode.test.js
 * @description Render tests for the NOR gate node component.
 */

import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import NorGateNode from './NorGateNode';

const wrap = (ui) => render(<ReactFlowProvider>{ui}</ReactFlowProvider>);

test('renders the gate label', () => {
  wrap(<NorGateNode data={{ label: 'NOR Gate', value: 0 }} />);
  expect(screen.getByText('NOR Gate')).toBeInTheDocument();
});

test('shows red background when value is 0', () => {
  const { container } = wrap(<NorGateNode data={{ label: 'NOR Gate', value: 0 }} />);
  expect(container.firstChild).toHaveStyle('background: #ffaaaa');
});

test('shows yellow background when value is 1', () => {
  const { container } = wrap(<NorGateNode data={{ label: 'NOR Gate', value: 1 }} />);
  expect(container.firstChild).toHaveStyle('background: yellow');
});
