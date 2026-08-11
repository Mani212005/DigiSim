/**
 * @file HotkeyCheatsheetModal.test.tsx
 * @description Unit tests for HotkeyCheatsheetModal and HotkeyFloatingTrigger.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { HotkeyCheatsheetModal, HotkeyFloatingTrigger } from './HotkeyCheatsheetModal';

describe('HotkeyCheatsheetModal and HotkeyFloatingTrigger', () => {
  const mockProps = {
    open: true,
    onClose: jest.fn(),
    onOpenCommandPalette: jest.fn(),
    onToggleSimulation: jest.fn(),
    onToggleWireMode: jest.fn(),
    onToggleProbeMode: jest.fn(),
    onUndo: jest.fn(),
    onPopHierarchy: jest.fn(),
    onToggleTerminal: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not render when open is false', () => {
    const { container } = render(<HotkeyCheatsheetModal {...mockProps} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders all key shortcuts when open', () => {
    render(<HotkeyCheatsheetModal {...mockProps} />);
    expect(screen.getByText('DigiSim Keyboard Shortcuts & Ergonomics')).toBeInTheDocument();
    expect(screen.getByText('Command Palette')).toBeInTheDocument();
    expect(screen.getByText('Run / Pause Simulation')).toBeInTheDocument();
    expect(screen.getByText('Wire Mode')).toBeInTheDocument();
    expect(screen.getByText('Probe Mode / Inspector')).toBeInTheDocument();
    expect(screen.getByText('Remove Selected')).toBeInTheDocument();
    expect(screen.getByText('Undo Action')).toBeInTheDocument();
    expect(screen.getByText('Drill Down into Sub-Circuit')).toBeInTheDocument();
    expect(screen.getByText('Pop Hierarchy')).toBeInTheDocument();
  });

  it('filters shortcuts by category tabs', () => {
    render(<HotkeyCheatsheetModal {...mockProps} />);
    const simTab = screen.getByRole('button', { name: 'Simulation' });

    fireEvent.click(simTab);
    expect(screen.getByText('Run / Pause Simulation')).toBeInTheDocument();
    expect(screen.queryByText('Wire Mode')).not.toBeInTheDocument();
  });

  it('filters shortcuts by search query', () => {
    render(<HotkeyCheatsheetModal {...mockProps} />);
    const searchInput = screen.getByPlaceholderText(/Search shortcuts/i);

    fireEvent.change(searchInput, { target: { value: 'wire' } });
    expect(screen.getByText('Wire Mode')).toBeInTheDocument();
    expect(screen.queryByText('Run / Pause Simulation')).not.toBeInTheDocument();
  });

  it('triggers interactive action when Try button is clicked', () => {
    render(<HotkeyCheatsheetModal {...mockProps} />);
    const tryPaletteBtn = screen.getByText('Open Palette ›');

    fireEvent.click(tryPaletteBtn);
    expect(mockProps.onClose).toHaveBeenCalled();
    expect(mockProps.onOpenCommandPalette).toHaveBeenCalled();
  });

  it('closes on Escape key press', () => {
    render(<HotkeyCheatsheetModal {...mockProps} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockProps.onClose).toHaveBeenCalled();
  });

  it('renders HotkeyFloatingTrigger and handles clicks', () => {
    const onTriggerClick = jest.fn();
    render(<HotkeyFloatingTrigger onClick={onTriggerClick} />);

    const triggerBtn = screen.getByRole('button', { name: /Keyboard Shortcuts/i });
    expect(triggerBtn).toBeInTheDocument();

    fireEvent.click(triggerBtn);
    expect(onTriggerClick).toHaveBeenCalled();
  });
});
