/**
 * @file NotGateNode.test.js
 * @description Render tests for the NOT gate node component.
 */

import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import NotGateNode from './NotGateNode';

const wrap = (ui) => render(<ReactFlowProvider>{ui}</ReactFlowProvider>);

test('renders the gate label', () => {
  wrap(<NotGateNode data={{ label: 'NOT Gate', value: 0 }} />);
  expect(screen.getByText('NOT Gate')).toBeInTheDocument();
});

test('shows red background when value is 0', () => {
  const { container } = wrap(<NotGateNode data={{ label: 'NOT Gate', value: 0 }} />);
  expect(container.firstChild).toHaveStyle('background: #ffaaaa');
});

test('shows yellow background when value is 1', () => {
  const { container } = wrap(<NotGateNode data={{ label: 'NOT Gate', value: 1 }} />);
  expect(container.firstChild).toHaveStyle('background: yellow');
});
