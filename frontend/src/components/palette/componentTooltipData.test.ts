/**
 * @file componentTooltipData.test.ts
 * @description Unit tests verifying metadata, pin specifications, and formulas in componentTooltipData.
 */

import { COMPONENT_TOOLTIP_DATA } from './componentTooltipData';

describe('COMPONENT_TOOLTIP_DATA', () => {
  it('contains comprehensive metadata for all core digital gates', () => {
    const digitalGates = ['andGate', 'orGate', 'notGate', 'nandGate', 'norGate', 'xorGate', 'xnorGate'];
    for (const gate of digitalGates) {
      const data = COMPONENT_TOOLTIP_DATA[gate];
      expect(data).toBeDefined();
      expect(data.name).toBeTruthy();
      expect(data.category).toBeTruthy();
      expect(data.description).toBeTruthy();
      expect(data.pins).toContain('Pins');
      expect(data.formula).toBeTruthy();
    }
  });

  it('contains comprehensive metadata for analog parts and sources', () => {
    const analogParts = ['vsource', 'ground', 'resistor', 'potentiometer', 'led', 'analogSwitch'];
    for (const part of analogParts) {
      const data = COMPONENT_TOOLTIP_DATA[part];
      expect(data).toBeDefined();
      expect(data.name).toBeTruthy();
      expect(data.category).toBeTruthy();
      expect(data.description).toBeTruthy();
      expect(data.pins).toBeTruthy();
      expect(data.formula).toBeTruthy();
    }
  });

  it('contains BSIM formulas and 4-terminal specs for MOSFETs and Subckt', () => {
    expect(COMPONENT_TOOLTIP_DATA.nmos.pins).toContain('4 Pins');
    expect(COMPONENT_TOOLTIP_DATA.nmos.formula).toContain('μ_n');
    expect(COMPONENT_TOOLTIP_DATA.pmos.pins).toContain('4 Pins');
    expect(COMPONENT_TOOLTIP_DATA.pmos.formula).toContain('μ_p');
    expect(COMPONENT_TOOLTIP_DATA.subckt.description).toContain('OpenAccess');
  });
});
