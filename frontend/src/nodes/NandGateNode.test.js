/**
 * @file NandGateNode.test.js
 * @description Render tests for the NAND gate node component.
 */

import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import NandGateNode from './NandGateNode';

const wrap = (ui) => render(<ReactFlowProvider>{ui}</ReactFlowProvider>);

test('renders the gate label', () => {
  wrap(<NandGateNode data={{ label: 'NAND Gate', value: 0 }} />);
  expect(screen.getByText('NAND Gate')).toBeInTheDocument();
});

test('shows red background when value is 0', () => {
  const { container } = wrap(<NandGateNode data={{ label: 'NAND Gate', value: 0 }} />);
  expect(container.firstChild).toHaveStyle('background: #ffaaaa');
});

test('shows yellow background when value is 1', () => {
  const { container } = wrap(<NandGateNode data={{ label: 'NAND Gate', value: 1 }} />);
  expect(container.firstChild).toHaveStyle('background: yellow');
});
