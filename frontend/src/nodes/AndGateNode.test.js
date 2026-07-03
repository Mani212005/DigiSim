/**
 * @file AndGateNode.test.js
 * @description Render tests for the AND gate node component.
 */

import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import AndGateNode from './AndGateNode';

const wrap = (ui) => render(<ReactFlowProvider>{ui}</ReactFlowProvider>);

test('renders the gate label', () => {
  wrap(<AndGateNode data={{ label: 'AND Gate', value: 0 }} />);
  expect(screen.getByText('AND Gate')).toBeInTheDocument();
});

test('shows red background when value is 0', () => {
  const { container } = wrap(<AndGateNode data={{ label: 'AND Gate', value: 0 }} />);
  expect(container.firstChild).toHaveStyle('background: #ffaaaa');
});

test('shows yellow background when value is 1', () => {
  const { container } = wrap(<AndGateNode data={{ label: 'AND Gate', value: 1 }} />);
  expect(container.firstChild).toHaveStyle('background: yellow');
});
