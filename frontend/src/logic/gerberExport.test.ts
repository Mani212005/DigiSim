/**
 * @file gerberExport.test.ts
 * @description Unit tests for standard RS-274X PCB Gerber file generation.
 */

import { generateGerberRS274X } from './gerberExport';
import type { DigiEdge, DigiNode } from '../types';

describe('generateGerberRS274X', () => {
  const sampleNodes: DigiNode[] = [
    {
      id: '1',
      position: { x: 100, y: 100 },
      data: { label: 'Input A', value: 1 },
      type: 'input',
    },
    {
      id: '2',
      position: { x: 300, y: 100 },
      data: { label: 'AND Gate', value: 0 },
      type: 'andGate',
    },
  ];

  const sampleEdges: DigiEdge[] = [
    {
      id: 'e1-2',
      source: '1',
      target: '2',
      sourceHandle: null,
      targetHandle: 'a',
    },
  ];

  it('generates valid RS-274X header format', () => {
    const gerber = generateGerberRS274X(sampleNodes, sampleEdges, { layerName: 'Top_Copper' });
    expect(gerber).toContain('%FSLAX44Y44*%');
    expect(gerber).toContain('%MOMM*%');
    expect(gerber).toContain('%LNTop_Copper*%');
    expect(gerber).toContain('%LPD*%');
    expect(gerber).toContain('M02*');
  });

  it('defines standard apertures for traces and pads', () => {
    const gerber = generateGerberRS274X(sampleNodes, sampleEdges);
    expect(gerber).toContain('%ADD10C,'); // Circular trace aperture
    expect(gerber).toContain('%ADD11C,'); // Circular pad aperture
    expect(gerber).toContain('%ADD12R,'); // Rectangular SMD pad
    expect(gerber).toContain('%ADD13C,'); // Board outline
  });

  it('flashes component pads for all placed nodes', () => {
    const gerber = generateGerberRS274X(sampleNodes, sampleEdges);
    expect(gerber).toContain('D11*');
    expect(gerber).toContain('D03*'); // Flash command
  });

  it('draws interpolated trace segments for wires between nodes', () => {
    const gerber = generateGerberRS274X(sampleNodes, sampleEdges);
    expect(gerber).toContain('D10*'); // Select trace aperture
    expect(gerber).toContain('D02*'); // Move without exposure
    expect(gerber).toContain('D01*'); // Draw with exposure
  });

  it('handles empty circuits gracefully', () => {
    const gerber = generateGerberRS274X([], []);
    expect(gerber).toContain('%FSLAX44Y44*%');
    expect(gerber).toContain('M02*');
  });
});
