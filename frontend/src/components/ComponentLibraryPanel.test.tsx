import React from 'react';
import { render, screen } from '@testing-library/react';
import { ComponentLibraryPanel } from './ComponentLibraryPanel';
import type { CustomComponentDefinition } from '../types';

describe('ComponentLibraryPanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('renders user library and predefined components', () => {
    const mockComponent: CustomComponentDefinition = {
      id: 'mock-1',
      name: 'Mock MUX',
      category: 'User Library',
      pins: [],
      subcircuit: { nodes: [], edges: [] },
      createdAt: '',
      updatedAt: ''
    };
    localStorage.setItem('customComponents', JSON.stringify([mockComponent]));

    render(
      <ComponentLibraryPanel 
        onPaletteDragStart={() => {}} 
        addNode={() => {}} 
      />
    );
    
    // Should see "Mock MUX" in the list
    expect(screen.getByText('Mock MUX')).toBeInTheDocument();
  });
});
