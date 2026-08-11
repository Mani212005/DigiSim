/**
 * @file SidebarTooltips.test.tsx
 * @description Unit tests for Sidebar component hover tooltips, pin specifications, and formulas.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import Sidebar, { ComponentTooltipCard } from './Sidebar';
import { COMPONENT_TOOLTIP_DATA } from './palette/componentTooltipData';
import type { PaletteEntry } from '../types';

describe('Sidebar and ComponentTooltipCard', () => {
  const gatePalette: PaletteEntry[] = [
    { type: 'andGate', label: 'AND Gate', glyph: 'and', name: 'AND' },
    { type: 'orGate', label: 'OR Gate', glyph: 'or', name: 'OR' },
    { type: 'notGate', label: 'NOT Gate', glyph: 'not', name: 'NOT' },
    { type: 'nandGate', label: 'NAND Gate', glyph: 'nand', name: 'NAND' },
    { type: 'norGate', label: 'NOR Gate', glyph: 'nor', name: 'NOR' },
    { type: 'xorGate', label: 'XOR Gate', glyph: 'xor', name: 'XOR' },
    { type: 'xnorGate', label: 'XNOR Gate', glyph: 'xnor', name: 'XNOR' },
  ];

  const analogPalette = [
    { type: 'vsource', label: 'Voltage Source', name: 'Source', hint: '5V DC' },
    { type: 'ground', label: 'Ground', name: 'GND', hint: '0V reference' },
    { type: 'resistor', label: 'Resistor', name: 'Resistor', hint: '220Ω' },
    { type: 'led', label: 'LED', name: 'LED', hint: 'glows by current' },
    { type: 'analogSwitch', label: 'Switch', name: 'Switch', hint: 'click to toggle' },
    { type: 'potentiometer', label: 'Potentiometer', name: 'Pot', hint: '10kΩ' },
    { type: 'nmos', label: 'NMOS Transistor', name: 'NMOS', hint: '4-Terminal MOSFET' },
    { type: 'pmos', label: 'PMOS Transistor', name: 'PMOS', hint: '4-Terminal MOSFET' },
    { type: 'subckt', label: 'Sub-Circuit Block', name: 'Subckt', hint: 'OpenAccess Subckt' },
  ];

  const mockProps = {
    sidebarOpen: true,
    sidebarPinned: true,
    sidebarPeek: false,
    sidebarWidth: 260,
    sidebarView: 'library' as const,
    setSidebarView: jest.fn(),
    setSidebarPinned: jest.fn(),
    setSidebarPeek: jest.fn(),
    setSidebarOpen: jest.fn(),
    isTouch: false,
    holdSidebarPeek: jest.fn(),
    releaseSidebarPeek: jest.fn(),
    onPaletteDragStart: jest.fn(),
    addNode: jest.fn(),
    analogPalette,
    gatePalette,
    libraryComponents: [],
    filteredLibrary: [],
    librarySearch: '',
    setLibrarySearch: jest.fn(),
    onLibraryDragStart: jest.fn(),
    addHardwareNode: jest.fn(),
    handleImageUpload: jest.fn(),
    setCameraOpen: jest.fn(),
    sampleImages: [],
    handleSampleImageSelect: jest.fn(),
    clearCanvas: jest.fn(),
    startSidebarResize: jest.fn(),
  };

  it('renders ComponentTooltipCard with formula, pin count, and description', () => {
    render(<ComponentTooltipCard info={COMPONENT_TOOLTIP_DATA.andGate} />);
    expect(screen.getByText('AND Gate')).toBeInTheDocument();
    expect(screen.getByText('LOGIC GATE')).toBeInTheDocument();
    expect(screen.getByText(/3 Pins: \[In A, In B, Out Y\]/i)).toBeInTheDocument();
    expect(screen.getByText('Y = A · B (A ∧ B)')).toBeInTheDocument();
  });

  it('renders MOSFET tooltips with BSIM drain current formulas', () => {
    render(<ComponentTooltipCard info={COMPONENT_TOOLTIP_DATA.nmos} />);
    expect(screen.getByText('NMOS Transistor')).toBeInTheDocument();
    expect(screen.getByText('MOSFET (BSIM)')).toBeInTheDocument();
    expect(screen.getByText(/4 Pins: \[Drain \(D\), Gate \(G\), Source \(S\), Bulk \(B\)\]/i)).toBeInTheDocument();
    expect(screen.getByText(/I_D = ½ · μ_n·C_ox/i)).toBeInTheDocument();
  });

  it('renders digital and analog component chips with attached tooltips in Sidebar', () => {
    render(<Sidebar {...mockProps} />);
    // Check digital chips
    expect(screen.getByRole('button', { name: 'Add Input' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Output' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add AND Gate' })).toBeInTheDocument();
  });
});
