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

  it('renders streamlined NmosNode with IEEE symbol, specs, and double-click trigger', () => {
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

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
    expect(screen.getByText(/1\.2μ \/ 0\.18μ/i)).toBeInTheDocument();
    expect(screen.getByText('180nm')).toBeInTheDocument();

    const nodeCard = screen.getByTitle(/Double-click to edit Cadence Virtuoso Object Properties/i);
    fireEvent.doubleClick(nodeCard);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'digisim:open-node-properties',
        detail: { nodeId: 'n1' },
      })
    );
    dispatchSpy.mockRestore();
  });

  it('renders streamlined PmosNode with IEEE inversion bubble and specs', () => {
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
    expect(screen.getByText(/2\.4μ \/ 0\.09μ/i)).toBeInTheDocument();
    expect(screen.getByText('90nm')).toBeInTheDocument();
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

