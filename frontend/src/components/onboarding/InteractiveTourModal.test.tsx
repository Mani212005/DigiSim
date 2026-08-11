/**
 * @file InteractiveTourModal.test.tsx
 * @description Unit tests for the 60-Second Interactive Guided Onboarding Tour Modal.
 * Verifies 5-step navigation (Palette, MOSFETs, Falstad flow, Copilot, 3D PCB),
 * progress indicators, keyboard navigation, localStorage persistence, and gallery launch.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import InteractiveTourModal from './InteractiveTourModal';

describe('InteractiveTourModal', () => {
  const mockOnClose = jest.fn();
  const mockOnOpenGallery = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  test('does not render when open is false', () => {
    const { container } = render(
      <InteractiveTourModal
        open={false}
        onClose={mockOnClose}
        onOpenGallery={mockOnOpenGallery}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders step 1 by default (Canvas & Component Palette)', () => {
    render(
      <InteractiveTourModal
        open={true}
        onClose={mockOnClose}
        onOpenGallery={mockOnOpenGallery}
      />
    );

    expect(screen.getByText(/step 1 of 5/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /canvas & component palette/i })).toBeInTheDocument();
    expect(screen.getAllByText(/schematic canvas/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /next step →/i })).toBeInTheDocument();
  });

  test('navigates through all 5 onboarding steps via Next and Back buttons', () => {
    render(
      <InteractiveTourModal
        open={true}
        onClose={mockOnClose}
        onOpenGallery={mockOnOpenGallery}
      />
    );

    // Step 1 -> Step 2 (MOSFETs & PDKs)
    fireEvent.click(screen.getByRole('button', { name: /next step →/i }));
    expect(screen.getByText(/step 2 of 5/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /4-terminal mosfets & multi-node pdks/i })).toBeInTheDocument();

    // Step 2 -> Step 3 (Falstad Current Flow)
    fireEvent.click(screen.getByRole('button', { name: /next step →/i }));
    expect(screen.getByText(/step 3 of 5/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /falstad current flow & waveform suite/i })).toBeInTheDocument();

    // Step 3 -> Step 4 (DigiCopilot AI)
    fireEvent.click(screen.getByRole('button', { name: /next step →/i }));
    expect(screen.getByText(/step 4 of 5/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /digicopilot ai circuit synthesizer/i })).toBeInTheDocument();

    // Step 4 -> Step 5 (3D Multi-Layer PCB)
    fireEvent.click(screen.getByRole('button', { name: /next step →/i }));
    expect(screen.getByText(/step 5 of 5/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /interactive 3d multi-layer pcb view/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start exploring/i })).toBeInTheDocument();

    // Step 5 -> Back to Step 4
    fireEvent.click(screen.getByRole('button', { name: /← back/i }));
    expect(screen.getByText(/step 4 of 5/i)).toBeInTheDocument();
  });

  test('clicking step indicator dot jumps directly to that step', () => {
    render(
      <InteractiveTourModal
        open={true}
        onClose={mockOnClose}
        onOpenGallery={mockOnOpenGallery}
      />
    );

    // Jump to Step 3
    fireEvent.click(screen.getByRole('button', { name: /go to step 3/i }));
    expect(screen.getByText(/step 3 of 5/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /falstad current flow & waveform suite/i })).toBeInTheDocument();
  });

  test('supports keyboard navigation via ArrowRight, ArrowLeft, and Escape', () => {
    render(
      <InteractiveTourModal
        open={true}
        onClose={mockOnClose}
        onOpenGallery={mockOnOpenGallery}
      />
    );

    // ArrowRight advances step
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText(/step 2 of 5/i)).toBeInTheDocument();

    // ArrowLeft goes back
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText(/step 1 of 5/i)).toBeInTheDocument();

    // Escape closes modal
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  test('saves dont show again preference to localStorage upon tour completion', () => {
    render(
      <InteractiveTourModal
        open={true}
        onClose={mockOnClose}
        onOpenGallery={mockOnOpenGallery}
      />
    );

    // Check "Don't show this guide on startup"
    const checkbox = screen.getByLabelText(/don't show this guide on startup/i);
    fireEvent.click(checkbox);

    // Jump to step 5 and finish
    fireEvent.click(screen.getByRole('button', { name: /go to step 5/i }));
    fireEvent.click(screen.getByRole('button', { name: /start exploring/i }));

    expect(mockOnClose).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('digisim_tour_completed')).toBe('true');
  });

  test('clicking Open Examples Showcase closes tour and triggers gallery', () => {
    render(
      <InteractiveTourModal
        open={true}
        onClose={mockOnClose}
        onOpenGallery={mockOnOpenGallery}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /open examples showcase/i }));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
    expect(mockOnOpenGallery).toHaveBeenCalledTimes(1);
  });
});
