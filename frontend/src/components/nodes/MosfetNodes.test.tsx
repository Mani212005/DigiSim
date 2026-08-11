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

  it('renders Virtuoso NMOS symbol with red square pins and CDF annotations', () => {
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

    render(
      <ReactFlowProvider>
        <NmosNode
          id="n1"
          data={{ label: 'NM0', value: 0, techNode: '180nm', width: 1.2, length: 0.18, region: 'Saturation' }}
          updateNodeData={mockUpdateNodeData}
        />
      </ReactFlowProvider>
    );

    expect(screen.getByText('nmos')).toBeInTheDocument();
    expect(screen.getByText('NM0')).toBeInTheDocument();
    expect(screen.getByText(/w:1\.2u/i)).toBeInTheDocument();
    expect(screen.getByText(/l:180n/i)).toBeInTheDocument();
    expect(screen.getByText(/m:1/i)).toBeInTheDocument();

    const nodeCard = screen.getByTitle(/NMOS Transistor/i);
    fireEvent.doubleClick(nodeCard);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'digisim:open-node-properties',
        detail: { nodeId: 'n1' },
      })
    );
    dispatchSpy.mockRestore();
  });

  it('renders Virtuoso PMOS symbol with inversion bubble and CDF annotations', () => {
    render(
      <ReactFlowProvider>
        <PmosNode
          id="p1"
          data={{ label: 'PM0', value: 0, techNode: '90nm', width: 2.4, length: 0.09, region: 'Triode', autoBulk: true }}
          updateNodeData={mockUpdateNodeData}
        />
      </ReactFlowProvider>
    );

    expect(screen.getByText('pmos')).toBeInTheDocument();
    expect(screen.getByText('PM0')).toBeInTheDocument();
    expect(screen.getByText(/w:2\.4u/i)).toBeInTheDocument();
    expect(screen.getByText(/l:90n/i)).toBeInTheDocument();
    expect(screen.getByText(/m:1/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/PMOS Schematic Symbol/i)).toBeInTheDocument();
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

