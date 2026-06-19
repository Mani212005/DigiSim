/**
 * @file XorGateNode.test.js
 * @description Render tests for the XOR gate node component.
 */

import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import XorGateNode from './XorGateNode';

const wrap = (ui) => render(<ReactFlowProvider>{ui}</ReactFlowProvider>);

test('renders the gate label', () => {
  wrap(<XorGateNode data={{ label: 'XOR Gate', value: 0 }} />);
  expect(screen.getByText('XOR Gate')).toBeInTheDocument();
});

test('shows red background when value is 0', () => {
  const { container } = wrap(<XorGateNode data={{ label: 'XOR Gate', value: 0 }} />);
  expect(container.firstChild).toHaveStyle('background: #ffaaaa');
});

test('shows yellow background when value is 1', () => {
  const { container } = wrap(<XorGateNode data={{ label: 'XOR Gate', value: 1 }} />);
  expect(container.firstChild).toHaveStyle('background: yellow');
});
