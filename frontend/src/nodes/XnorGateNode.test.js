/**
 * @file XnorGateNode.test.js
 * @description Render tests for the XNOR gate node component.
 */

import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import XnorGateNode from './XnorGateNode';

const wrap = (ui) => render(<ReactFlowProvider>{ui}</ReactFlowProvider>);

test('renders the gate label', () => {
  wrap(<XnorGateNode data={{ label: 'XNOR Gate', value: 0 }} />);
  expect(screen.getByText('XNOR Gate')).toBeInTheDocument();
});

test('shows red background when value is 0', () => {
  const { container } = wrap(<XnorGateNode data={{ label: 'XNOR Gate', value: 0 }} />);
  expect(container.firstChild).toHaveStyle('background: #ffaaaa');
});

test('shows green background when value is 1', () => {
  const { container } = wrap(<XnorGateNode data={{ label: 'XNOR Gate', value: 1 }} />);
  expect(container.firstChild).toHaveStyle('background: #aaffaa');
});
