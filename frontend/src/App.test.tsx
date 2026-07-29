/**
 * @file App.test.js
 * @description Smoke tests for the DigiSim root App component — verifies the navbar,
 * the toolbox menu navigation, palette sections, and vision section render correctly.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';

test('renders the DigiSim brand and Circuit Analyzer tag', () => {
  render(<App />);
  expect(screen.getByText('DigiSim')).toBeInTheDocument();
  expect(screen.getByText(/circuit analyzer/i)).toBeInTheDocument();
});

test('toolbox menu lists the Component Library and Vision sections', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: /component library/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /vision/i })).toBeInTheDocument();
});

test('opening Component Library shows the I/O, analog, gate, and library sections with a back button', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /component library/i }));
  expect(screen.getByText(/^i\/o & analog$/i)).toBeInTheDocument();
  expect(screen.getByText(/^logic gates$/i)).toBeInTheDocument();
  // Back returns to the menu.
  fireEvent.click(screen.getByRole('button', { name: /back to toolbox menu/i }));
  expect(screen.getByRole('button', { name: /component library/i })).toBeInTheDocument();
});

test('renders a palette chip for every gate type', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /component library/i }));
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
  expect(screen.getByLabelText(/search component library/i)).toBeInTheDocument();
});

test('opening Vision shows the Image Upload control', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /^vision/i }));
  expect(screen.getByText(/image upload/i)).toBeInTheDocument();
});

test('renders the Clear Canvas button', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: /clear canvas/i })).toBeInTheDocument();
});
