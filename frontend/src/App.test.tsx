/**
 * @file App.test.tsx
 * @description Smoke tests for the DigiSim root App component — verifies the EDA navbar,
 * transport controls, silicon component palette sections, and modal triggers.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';

test('renders the DigiSim brand and v2.0 Pro tag', () => {
  render(<App />);
  expect(screen.getByText('DigiSim')).toBeInTheDocument();
  expect(screen.getByText(/v2\.0 pro/i)).toBeInTheDocument();
});

test('renders professional EDA menu bar and transport controls', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: /file/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /simulate/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /tools/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /help/i })).toBeInTheDocument();
  expect(screen.getByTitle(/run \/ pause simulation/i)).toBeInTheDocument();
});

test('toolbox menu lists the Silicon Primitives and Vision sections', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: /silicon primitives/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /vision ocr/i })).toBeInTheDocument();
});

test('opening Silicon Primitives shows transistor categories and allows navigation back', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /silicon primitives/i }));
  expect(screen.getByText(/cmos transistors \(bsim\)/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /add nmos transistor/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /add pmos transistor/i })).toBeInTheDocument();

  // Back returns to the menu.
  fireEvent.click(screen.getByRole('button', { name: /back to toolbox menu/i }));
  expect(screen.getByRole('button', { name: /silicon primitives/i })).toBeInTheDocument();
});

test('renders a palette chip for every gate type when switching to Logic Gates tab', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /silicon primitives/i }));
  fireEvent.click(screen.getByRole('button', { name: /logic gates/i }));

  // Advanced gates are collapsed by default
  fireEvent.click(screen.getByText(/^arithmetic & parity gates$/i));

  for (const gate of ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR']) {
    expect(
      screen.getByRole('button', { name: new RegExp(`add ${gate} gate`, 'i') })
    ).toBeInTheDocument();
  }
});

test('renders Input and Output palette chips in Logic Gates tab', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /silicon primitives/i }));
  fireEvent.click(screen.getByRole('button', { name: /logic gates/i }));
  expect(screen.getByRole('button', { name: /add input/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /add output/i })).toBeInTheDocument();
});

test('renders passives and power references when switching to Passives & Ref tab', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /silicon primitives/i }));
  fireEvent.click(screen.getByRole('button', { name: /passives & ref/i }));
  expect(screen.getByRole('button', { name: /add voltage source/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /add ground/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /add resistor/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /add capacitor/i })).toBeInTheDocument();
});

test('opening Vision shows the Image Upload control', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /vision ocr/i }));
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
