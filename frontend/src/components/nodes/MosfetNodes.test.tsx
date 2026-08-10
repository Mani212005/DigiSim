/**
 * @file MosfetNodes.test.tsx
 * @description Component tests for NmosNode, PmosNode, and SubcktNode.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import NmosNode from './NmosNode';
import PmosNode from './PmosNode';
import SubcktNode from './SubcktNode';

const mockUpdateNodeData = jest.fn();

describe('Mosfet & Subckt Nodes', () => {
  beforeEach(() => {
    mockUpdateNodeData.mockReset();
  });

  it('renders NmosNode with live region badge and PDK inputs', () => {
    render(
      <ReactFlowProvider>
        <NmosNode
          id="n1"
          data={{ label: 'M_NMOS1', value: 0, techNode: '180nm', width: 1.2, length: 0.18, region: 'Saturation' }}
          updateNodeData={mockUpdateNodeData}
        />
      </ReactFlowProvider>
    );

    expect(screen.getByText('M_NMOS1')).toBeInTheDocument();
    expect(screen.getByText('Saturation')).toBeInTheDocument();
    expect(screen.getByText(/180nm CMOS/i)).toBeInTheDocument();

    const wInput = screen.getByDisplayValue('1.2');
    fireEvent.change(wInput, { target: { value: '2.4' } });
    expect(mockUpdateNodeData).toHaveBeenCalledWith('n1', { width: 2.4 });
  });

  it('renders PmosNode with live region badge and auto-bulk checkbox', () => {
    render(
      <ReactFlowProvider>
        <PmosNode
          id="p1"
          data={{ label: 'M_PMOS1', value: 0, techNode: '90nm', width: 2.4, length: 0.09, region: 'Triode', autoBulk: true }}
          updateNodeData={mockUpdateNodeData}
        />
      </ReactFlowProvider>
    );

    expect(screen.getByText('M_PMOS1')).toBeInTheDocument();
    expect(screen.getByText('Triode')).toBeInTheDocument();
    expect(screen.getByText(/Auto-Bulk/i)).toBeInTheDocument();
  });

  it('renders SubcktNode with parameter pass-through and drill down button', () => {
    const mockDrillDown = jest.fn();

    render(
      <ReactFlowProvider>
        <SubcktNode
          id="x1"
          data={{ label: 'X1_INV', value: 0, cellName: 'INVERTER', params: { W_p: 2.4, W_n: 1.2, L: 0.18 } }}
          updateNodeData={mockUpdateNodeData}
          onDrillDown={mockDrillDown}
        />
      </ReactFlowProvider>
    );

    expect(screen.getByText('X1_INV')).toBeInTheDocument();
    expect(screen.getByText(':INVERTER')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2.4')).toBeInTheDocument();

    const drillBtn = screen.getByText(/Push \/ Drill Down/i);
    fireEvent.click(drillBtn);
    expect(mockDrillDown).toHaveBeenCalledWith('INVERTER', { W_p: 2.4, W_n: 1.2, L: 0.18 });
  });
});
