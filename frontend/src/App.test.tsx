/**
 * @file App.test.tsx
 * @description Smoke tests for the DigiSim root App component — verifies the navbar,
 * the menu dropdowns, transport controls, palette sections, and modal triggers.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';

test('renders the DigiSim brand and v2.0 Pro tag', () => {
  render(<App />);
  expect(screen.getByText('DigiSim')).toBeInTheDocument();
  expect(screen.getByText(/v2\.0 pro/i)).toBeInTheDocument();
});

test('renders professional menu bar and transport controls', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: /file/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /simulate/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /tools/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /help/i })).toBeInTheDocument();
  expect(screen.getByTitle(/run \/ pause simulation/i)).toBeInTheDocument();
});

test('toolbox menu lists the Component Library and Vision sections', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: /component library/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /vision/i })).toBeInTheDocument();
});

test('opening Component Library shows the I/O, analog, gate, and library sections with a back button', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /component library/i }));
  expect(screen.getByText(/^input \/ output$/i)).toBeInTheDocument();
  expect(screen.getByText(/^basic gates$/i)).toBeInTheDocument();
  // Back returns to the menu.
  fireEvent.click(screen.getByRole('button', { name: /back to toolbox menu/i }));
  expect(screen.getByRole('button', { name: /component library/i })).toBeInTheDocument();
});

test('renders a palette chip for every gate type', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /component library/i }));
  
  // Advanced gates are collapsed by default
  fireEvent.click(screen.getByText(/^advanced gates$/i));

  for (const gate of ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR']) {
    expect(
      screen.getByRole('button', { name: new RegExp(`add ${gate} gate`, 'i') })
    ).toBeInTheDocument();
  }
});

test('renders Input and Output palette chips', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /component library/i }));
  expect(screen.getByRole('button', { name: /add input/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /add output/i })).toBeInTheDocument();
});

test('opening Library shows the part search', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /component library/i }));
  // Hardware tab must be clicked to see the search bar
  fireEvent.click(screen.getByRole('button', { name: /^hardware$/i }));
  expect(screen.getByPlaceholderText(/search.*parts/i)).toBeInTheDocument();
});

test('opening Vision shows the Image Upload control', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /^vision/i }));
  expect(screen.getByText(/image upload/i)).toBeInTheDocument();
});

test('renders the Clear Canvas button in toolbox', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: /clear canvas/i })).toBeInTheDocument();
});

test('clicking Examples opens the CircuitGalleryModal', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /examples/i }));
  expect(screen.getByRole('heading', { level: 2, name: /circuit gallery showcase/i })).toBeInTheDocument();
  expect(screen.getByText('180nm CMOS Inverter')).toBeInTheDocument();
});

test('opening Help menu allows launching the 60-Sec Interactive Guide', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /help/i }));
  fireEvent.click(screen.getByRole('button', { name: /60-sec interactive guide/i }));
  expect(screen.getByText(/step 1 of 5/i)).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: /canvas & component palette/i })).toBeInTheDocument();
});

