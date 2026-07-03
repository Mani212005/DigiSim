/**
 * @file OrGateNode.test.js
 * @description Render tests for the OR gate node component.
 */

import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import OrGateNode from './OrGateNode';

const wrap = (ui) => render(<ReactFlowProvider>{ui}</ReactFlowProvider>);

test('renders the gate label', () => {
  wrap(<OrGateNode data={{ label: 'OR Gate', value: 0 }} />);
  expect(screen.getByText('OR Gate')).toBeInTheDocument();
});

test('shows red background when value is 0', () => {
  const { container } = wrap(<OrGateNode data={{ label: 'OR Gate', value: 0 }} />);
  expect(container.firstChild).toHaveStyle('background: #ffaaaa');
});

test('shows yellow background when value is 1', () => {
  const { container } = wrap(<OrGateNode data={{ label: 'OR Gate', value: 1 }} />);
  expect(container.firstChild).toHaveStyle('background: yellow');
});
