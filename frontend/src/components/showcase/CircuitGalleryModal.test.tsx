/**
 * @file CircuitGalleryModal.test.tsx
 * @description Unit tests for the CircuitGalleryModal showcase component.
 * Verifies curated circuit rendering, filtering by category, search queries,
 * difficulty level selection, and 1-click playable canvas circuit loading.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import CircuitGalleryModal from './CircuitGalleryModal';
import { SAMPLE_CIRCUITS } from './sampleCircuitsData';
import type { SampleCircuit } from '../../types';

describe('CircuitGalleryModal', () => {
  const mockOnClose = jest.fn();
  const mockOnLoadCircuit = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('does not render when open is false', () => {
    const { container } = render(
      <CircuitGalleryModal
        open={false}
        onClose={mockOnClose}
        onLoadCircuit={mockOnLoadCircuit}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders modal title and all 6 curated sample circuits by default', () => {
    render(
      <CircuitGalleryModal
        open={true}
        onClose={mockOnClose}
        onLoadCircuit={mockOnLoadCircuit}
      />
    );

    expect(screen.getByText(/circuit gallery showcase/i)).toBeInTheDocument();
    expect(screen.getByText('180nm CMOS Inverter')).toBeInTheDocument();
    expect(screen.getByText('3-Stage CMOS Ring Oscillator')).toBeInTheDocument();
    expect(screen.getByText('NMOS Differential Pair Amplifier')).toBeInTheDocument();
    expect(screen.getByText('4-Bit Ripple Carry Full Adder')).toBeInTheDocument();
    expect(screen.getByText('555 Timer Astable Multivibrator')).toBeInTheDocument();
    expect(screen.getByText('LC Bandpass Filter & Eye Diagram')).toBeInTheDocument();
  });

  test('filters circuits by category tabs', () => {
    render(
      <CircuitGalleryModal
        open={true}
        onClose={mockOnClose}
        onLoadCircuit={mockOnLoadCircuit}
      />
    );

    // Filter by CMOS ICs
    fireEvent.click(screen.getByRole('button', { name: /cmos ics/i }));
    expect(screen.getByText('180nm CMOS Inverter')).toBeInTheDocument();
    expect(screen.getByText('3-Stage CMOS Ring Oscillator')).toBeInTheDocument();
    expect(screen.queryByText('4-Bit Ripple Carry Full Adder')).not.toBeInTheDocument();

    // Filter by Digital Logic
    fireEvent.click(screen.getByRole('button', { name: /digital logic/i }));
    expect(screen.getByText('4-Bit Ripple Carry Full Adder')).toBeInTheDocument();
    expect(screen.queryByText('180nm CMOS Inverter')).not.toBeInTheDocument();

    // Filter by RF & High-Speed
    fireEvent.click(screen.getByRole('button', { name: /rf & high-speed/i }));
    expect(screen.getByText('LC Bandpass Filter & Eye Diagram')).toBeInTheDocument();
    expect(screen.queryByText('555 Timer Astable Multivibrator')).not.toBeInTheDocument();
  });

  test('filters circuits via search input', () => {
    render(
      <CircuitGalleryModal
        open={true}
        onClose={mockOnClose}
        onLoadCircuit={mockOnLoadCircuit}
      />
    );

    const searchInput = screen.getByPlaceholderText(/search circuits/i);
    fireEvent.change(searchInput, { target: { value: 'differential' } });

    expect(screen.getByText('NMOS Differential Pair Amplifier')).toBeInTheDocument();
    expect(screen.queryByText('180nm CMOS Inverter')).not.toBeInTheDocument();

    // Clear search
    fireEvent.click(screen.getByRole('button', { name: /clear search/i }));
    expect(screen.getByText('180nm CMOS Inverter')).toBeInTheDocument();
  });

  test('filters circuits by difficulty pills', () => {
    render(
      <CircuitGalleryModal
        open={true}
        onClose={mockOnClose}
        onLoadCircuit={mockOnLoadCircuit}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^beginner$/i }));
    expect(screen.getByText('180nm CMOS Inverter')).toBeInTheDocument();
    expect(screen.queryByText('NMOS Differential Pair Amplifier')).not.toBeInTheDocument();
  });

  test('shows empty state when no circuits match query', () => {
    render(
      <CircuitGalleryModal
        open={true}
        onClose={mockOnClose}
        onLoadCircuit={mockOnLoadCircuit}
      />
    );

    const searchInput = screen.getByPlaceholderText(/search circuits/i);
    fireEvent.change(searchInput, { target: { value: 'nonexistent-query-xyz' } });

    expect(screen.getByText(/no matching circuits found/i)).toBeInTheDocument();

    // Clicking reset filters restores cards
    fireEvent.click(screen.getByRole('button', { name: /reset filters/i }));
    expect(screen.getByText('180nm CMOS Inverter')).toBeInTheDocument();
  });

  test('calls onLoadCircuit with correct circuit payload when clicking Load into Canvas', () => {
    render(
      <CircuitGalleryModal
        open={true}
        onClose={mockOnClose}
        onLoadCircuit={mockOnLoadCircuit}
      />
    );

    const loadButtons = screen.getAllByRole('button', { name: /load into canvas/i });
    expect(loadButtons.length).toBe(6);

    // Click the first circuit's load button (180nm CMOS Inverter)
    fireEvent.click(loadButtons[0]);

    expect(mockOnLoadCircuit).toHaveBeenCalledTimes(1);
    const loaded = mockOnLoadCircuit.mock.calls[0][0] as SampleCircuit;
    expect(loaded.id).toBe('cmos-inverter-180nm');
    expect(loaded.nodes.length).toBeGreaterThan(0);
    expect(loaded.edges.length).toBeGreaterThan(0);
  });

  test('closes modal when clicking close button or pressing Escape', () => {
    render(
      <CircuitGalleryModal
        open={true}
        onClose={mockOnClose}
        onLoadCircuit={mockOnLoadCircuit}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /close showcase modal/i }));
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledTimes(2);
  });
});
