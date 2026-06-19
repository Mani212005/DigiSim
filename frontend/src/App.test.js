/**
 * @file App.test.js
 * @description Smoke tests for the DigiSim root App component — verifies the navbar,
 * sidebar controls, and canvas wrapper render correctly.
 */

import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the Circuit Analyzer navbar brand', () => {
  render(<App />);
  expect(screen.getByText(/circuit analyzer/i)).toBeInTheDocument();
});

test('renders Add Components sidebar heading', () => {
  render(<App />);
  expect(screen.getByText(/add components/i)).toBeInTheDocument();
});

test('renders all gate buttons in the sidebar', () => {
  render(<App />);
  expect(screen.getByText(/add and gate/i)).toBeInTheDocument();
  expect(screen.getByText(/add or gate/i)).toBeInTheDocument();
  expect(screen.getByText(/add not gate/i)).toBeInTheDocument();
  expect(screen.getByText(/add nand gate/i)).toBeInTheDocument();
  expect(screen.getByText(/add nor gate/i)).toBeInTheDocument();
  expect(screen.getByText(/add xor gate/i)).toBeInTheDocument();
  expect(screen.getByText(/add xnor gate/i)).toBeInTheDocument();
});

test('renders Image Upload section', () => {
  render(<App />);
  expect(screen.getByText(/image upload/i)).toBeInTheDocument();
});

test('renders Clear Canvas button', () => {
  render(<App />);
  expect(screen.getByText(/clear canvas/i)).toBeInTheDocument();
});
