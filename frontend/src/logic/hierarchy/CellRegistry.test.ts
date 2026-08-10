/**
 * @file CellRegistry.test.ts
 * @description Unit tests for CellRegistry (OpenAccess cellviews, registration, and parameter pass-through).
 */

import { CellRegistry } from './CellRegistry';

describe('CellRegistry', () => {
  it('registers and retrieves built-in cells (INVERTER, NAND2, NOR2)', () => {
    const inv = CellRegistry.getCell('INVERTER');
    expect(inv).toBeDefined();
    expect(inv?.cellName).toBe('INVERTER');
    expect(inv?.ports).toHaveLength(4);
    expect(inv?.parameters.W_p).toBe(2.4);

    const nand = CellRegistry.getCell('NAND2');
    expect(nand).toBeDefined();
    expect(nand?.cellName).toBe('NAND2');

    const nor = CellRegistry.getCell('NOR2');
    expect(nor).toBeDefined();
    expect(nor?.cellName).toBe('NOR2');
  });

  it('instantiates schematic view with parameter pass-through overrides', () => {
    const instantiated = CellRegistry.instantiateSchematic('INVERTER', { W_p: 3.6, W_n: 1.8, L: 0.18 }, 'inst1');
    expect(instantiated.nodes).toHaveLength(2);
    expect(instantiated.edges).toHaveLength(2);

    const pmosNode = instantiated.nodes.find((n) => n.type === 'pmos');
    expect(pmosNode).toBeDefined();
    expect(pmosNode?.data.width).toBe(3.6);
    expect(pmosNode?.id).toBe('inst1_p1');

    const nmosNode = instantiated.nodes.find((n) => n.type === 'nmos');
    expect(nmosNode).toBeDefined();
    expect(nmosNode?.data.width).toBe(1.8);
    expect(nmosNode?.id).toBe('inst1_n1');
  });

  it('registers custom cell definitions', () => {
    CellRegistry.createDefaultCell('BUFFER', [
      { name: 'in', direction: 'in', side: 'left' },
      { name: 'out', direction: 'out', side: 'right' },
    ], { gain: 2 });

    const buf = CellRegistry.getCell('BUFFER');
    expect(buf).toBeDefined();
    expect(buf?.cellName).toBe('BUFFER');
    expect(buf?.parameters.gain).toBe(2);
  });
});
