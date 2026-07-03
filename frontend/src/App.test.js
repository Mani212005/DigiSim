/**
 * @file App.test.js
 * @description Smoke tests for the DigiSim root App component — verifies the navbar,
 * palette sidebar controls, and vision section render correctly.
 */

import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the DigiSim brand and Circuit Analyzer tag', () => {
  render(<App />);
  expect(screen.getByText('DigiSim')).toBeInTheDocument();
  expect(screen.getByText(/circuit analyzer/i)).toBeInTheDocument();
});

test('renders the I/O and Logic Gates palette sections', () => {
  render(<App />);
  expect(screen.getByText(/^i\/o$/i)).toBeInTheDocument();
  expect(screen.getByText(/logic gates/i)).toBeInTheDocument();
});

test('renders a palette chip for every gate type', () => {
  render(<App />);
  for (const gate of ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR']) {
    expect(
      screen.getByRole('button', { name: new RegExp(`add ${gate} gate`, 'i') })
    ).toBeInTheDocument();
  }
});

test('renders Input and Output palette chips', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: /add input/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /add output/i })).toBeInTheDocument();
});

test('renders the Image Upload control', () => {
  render(<App />);
  expect(screen.getByText(/image upload/i)).toBeInTheDocument();
});

test('renders the Clear Canvas button', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: /clear canvas/i })).toBeInTheDocument();
});
