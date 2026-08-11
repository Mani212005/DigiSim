/**
 * @file CommandPaletteModal.test.tsx
 * @description Unit tests for CommandPaletteModal component and fuzzy search engine.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPaletteModal, fuzzyScore } from './CommandPaletteModal';

describe('CommandPaletteModal and fuzzyScore', () => {
  describe('fuzzyScore algorithm', () => {
    it('accurately scores exact and prefix matches', () => {
      const exact = fuzzyScore('nmos', 'NMOS Transistor');
      expect(exact.matches).toBe(true);
      expect(exact.score).toBeGreaterThan(300);

      const prefix = fuzzyScore('and', 'AND Gate');
      expect(prefix.matches).toBe(true);
      expect(prefix.score).toBeGreaterThan(400);
    });

    it('matches fuzzy query characters in sequence', () => {
      const fuzzy = fuzzyScore('sw180', 'Switch to 180nm CMOS');
      expect(fuzzy.matches).toBe(true);
      expect(fuzzy.score).toBeGreaterThan(0);
    });

    it('rejects non-matching query strings', () => {
      const noMatch = fuzzyScore('quantum', 'Resistor Passive');
      expect(noMatch.matches).toBe(false);
      expect(noMatch.score).toBe(0);
    });
  });

  describe('CommandPaletteModal component', () => {
    const mockProps = {
      open: true,
      onClose: jest.fn(),
      onAddComponent: jest.fn(),
      onAddHardwareNode: jest.fn(),
      onSwitchPDK: jest.fn(),
      onRunSimulation: jest.fn(),
      onStepSimulation: jest.fn(),
      onResetSimulation: jest.fn(),
      onOpenPcb3D: jest.fn(),
      onOpenCopilot: jest.fn(),
      onExportSpice: jest.fn(),
      onExportGerber: jest.fn(),
      onExportJson: jest.fn(),
      onToggleTerminal: jest.fn(),
      onToggleWireMode: jest.fn(),
      onToggleProbeMode: jest.fn(),
      onDrillDown: jest.fn(),
      onPopHierarchy: jest.fn(),
      onFitView: jest.fn(),
      onClearCanvas: jest.fn(),
      onOpenHotkeyCheatsheet: jest.fn(),
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('does not render when open is false', () => {
      const { container } = render(<CommandPaletteModal {...mockProps} open={false} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders search input and commands when open', () => {
      render(<CommandPaletteModal {...mockProps} />);
      expect(screen.getByPlaceholderText(/Type a command/i)).toBeInTheDocument();
      expect(screen.getByText('NMOS Transistor')).toBeInTheDocument();
      expect(screen.getByText('PMOS Transistor')).toBeInTheDocument();
      expect(screen.getByText('AND Gate')).toBeInTheDocument();
      expect(screen.getByText('Switch to 180nm CMOS')).toBeInTheDocument();
    });

    it('filters components on fuzzy search query', () => {
      render(<CommandPaletteModal {...mockProps} />);
      const input = screen.getByPlaceholderText(/Type a command/i);

      fireEvent.change(input, { target: { value: 'nand' } });
      expect(screen.getByText('NAND Gate')).toBeInTheDocument();
      expect(screen.queryByText('PMOS Transistor')).not.toBeInTheDocument();
    });

    it('places a component on canvas when clicked', () => {
      render(<CommandPaletteModal {...mockProps} />);
      const nmosItem = screen.getByText('NMOS Transistor');

      fireEvent.click(nmosItem);
      expect(mockProps.onAddComponent).toHaveBeenCalledWith('nmos', 'NMOS', expect.any(Object));
      expect(mockProps.onClose).toHaveBeenCalled();
    });

    it('switches PDK process node when PDK command is selected', () => {
      render(<CommandPaletteModal {...mockProps} />);
      const pdk28 = screen.getByText('Switch to 28nm HKMG');

      fireEvent.click(pdk28);
      expect(mockProps.onSwitchPDK).toHaveBeenCalledWith('28nm');
      expect(mockProps.onClose).toHaveBeenCalled();
    });

    it('executes quick actions (Run, Step, Reset, 3D PCB, Copilot, SPICE, Gerber)', () => {
      render(<CommandPaletteModal {...mockProps} />);
      const input = screen.getByPlaceholderText(/Type a command/i);

      // 1. Run simulation
      fireEvent.change(input, { target: { value: 'Run Simulation' } });
      fireEvent.click(screen.getByText('Run Simulation'));
      expect(mockProps.onRunSimulation).toHaveBeenCalled();

      // 2. 3D PCB
      fireEvent.change(input, { target: { value: '3D PCB' } });
      fireEvent.click(screen.getByText('Open 3D PCB View'));
      expect(mockProps.onOpenPcb3D).toHaveBeenCalled();

      // 3. SPICE Netlist
      fireEvent.change(input, { target: { value: 'SPICE' } });
      fireEvent.click(screen.getByText('Export SPICE Netlist'));
      expect(mockProps.onExportSpice).toHaveBeenCalled();

      // 4. Gerber Export
      fireEvent.change(input, { target: { value: 'Gerber' } });
      fireEvent.click(screen.getByText('Export Gerber'));
      expect(mockProps.onExportGerber).toHaveBeenCalled();
    });

    it('navigates with keyboard (ArrowDown, ArrowUp, Enter, Escape)', () => {
      render(<CommandPaletteModal {...mockProps} />);
      const modal = screen.getByRole('dialog');

      // Press ArrowDown then Enter
      fireEvent.keyDown(modal.querySelector('.cmd-palette-modal')!, { key: 'ArrowDown' });
      fireEvent.keyDown(modal.querySelector('.cmd-palette-modal')!, { key: 'Enter' });
      expect(mockProps.onClose).toHaveBeenCalled();

      // Press Escape
      fireEvent.keyDown(modal.querySelector('.cmd-palette-modal')!, { key: 'Escape' });
      expect(mockProps.onClose).toHaveBeenCalled();
    });

    it('shows empty state when no commands match query', () => {
      render(<CommandPaletteModal {...mockProps} />);
      const input = screen.getByPlaceholderText(/Type a command/i);

      fireEvent.change(input, { target: { value: 'xyz123nonexistent' } });
      expect(screen.getByText(/No matching commands or components/i)).toBeInTheDocument();
    });
  });
});
