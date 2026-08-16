import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import PhotoToSchematicModal from './PhotoToSchematicModal';

describe('PhotoToSchematicModal component tests', () => {
  test('renders modal header and tabs', async () => {
    const handleClose = jest.fn();
    const handleApply = jest.fn();

    await act(async () => {
      render(<PhotoToSchematicModal onClose={handleClose} onApplySchematic={handleApply} />);
    });

    expect(screen.getByText(/"Snap-to-Simulate" YOLO Circuit Vision/i)).toBeInTheDocument();
    expect(screen.getByText(/Photo Upload & Drag\/Drop/i)).toBeInTheDocument();
    expect(screen.getByText(/Live Webcam Capture/i)).toBeInTheDocument();
  });

  test('calls onClose when cancel button is clicked', async () => {
    const handleClose = jest.fn();
    const handleApply = jest.fn();

    await act(async () => {
      render(<PhotoToSchematicModal onClose={handleClose} onApplySchematic={handleApply} />);
    });

    const cancelBtn = screen.getByText('Cancel');
    await act(async () => {
      fireEvent.click(cancelBtn);
    });

    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
