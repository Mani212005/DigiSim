/**
 * @file PDKManager.test.ts
 * @description Unit tests for PDKManager (180nm, 90nm, 28nm HKMG BSIM cards, CDF calculations, operating regions).
 */

import { PDKManager } from './PDKManager';

describe('PDKManager', () => {
  it('loads BSIM model cards for 180nm, 90nm, and 28nm HKMG nodes', () => {
    const card180n = PDKManager.getModelCard('180nm', 'nmos');
    expect(card180n.techNode).toBe('180nm');
    expect(card180n.Vth0).toBe(0.45);

    const card180p = PDKManager.getModelCard('180nm', 'pmos');
    expect(card180p.Vth0).toBe(-0.45);

    const card90n = PDKManager.getModelCard('90nm', 'nmos');
    expect(card90n.techNode).toBe('90nm');
    expect(card90n.Vth0).toBe(0.35);

    const card28n = PDKManager.getModelCard('28nm', 'nmos');
    expect(card28n.techNode).toBe('28nm');
    expect(card28n.Vth0).toBe(0.28);
    expect(card28n.name).toContain('HKMG');
  });

  it('calculates CDF parameters (ad, as, pd, ps) correctly', () => {
    const cdf180 = PDKManager.calculateCDF('180nm', 1.8, 0.18, 1);
    expect(cdf180.ad).toBeCloseTo(1.8 * 0.36, 3);
    expect(cdf180.as).toBeCloseTo(1.8 * 0.36, 3);
    expect(cdf180.pd).toBeCloseTo(2 * 1.8 + 2 * 0.36, 3);
    expect(cdf180.ps).toBeCloseTo(2 * 1.8 + 2 * 0.36, 3);

    const cdfMultiFinger = PDKManager.calculateCDF('180nm', 3.6, 0.18, 2);
    expect(cdfMultiFinger.ad).toBeCloseTo(1.8 * 0.36, 3);
  });

  it('determines Cutoff operating region for NMOS when Vgs < Vth', () => {
    const model = PDKManager.getModelCard('180nm', 'nmos');
    const result = PDKManager.calculateOperatingRegion('nmos', model, 1.8, 0.18, 1, 1.8, 0.0, 0.0, 0.0);
    expect(result.region).toBe('Cutoff');
    expect(result.ids).toBeLessThan(1e-12);
  });

  it('determines Saturation operating region for NMOS when Vgs > Vth and Vds >= Vov', () => {
    const model = PDKManager.getModelCard('180nm', 'nmos');
    const result = PDKManager.calculateOperatingRegion('nmos', model, 1.8, 0.18, 1, 1.8, 1.8, 0.0, 0.0);
    expect(result.region).toBe('Saturation');
    expect(result.ids).toBeGreaterThan(0);
  });

  it('determines Triode operating region for NMOS when Vgs > Vth and Vds < Vov', () => {
    const model = PDKManager.getModelCard('180nm', 'nmos');
    const result = PDKManager.calculateOperatingRegion('nmos', model, 1.8, 0.18, 1, 0.1, 1.8, 0.0, 0.0);
    expect(result.region).toBe('Triode');
    expect(result.ids).toBeGreaterThan(0);
  });

  it('calculates PMOS operating regions correctly', () => {
    const model = PDKManager.getModelCard('180nm', 'pmos');
    // Vsg = Vs - Vg = 1.8 - 0 = 1.8 > |Vth0| = 0.45. Vsd = Vs - Vd = 1.8 - 0 = 1.8 >= Vov => Saturation
    const satResult = PDKManager.calculateOperatingRegion('pmos', model, 2.4, 0.18, 1, 0.0, 0.0, 1.8, 1.8);
    expect(satResult.region).toBe('Saturation');
    expect(satResult.ids).toBeGreaterThan(0);

    // Vsg = 0 => Cutoff
    const cutoffResult = PDKManager.calculateOperatingRegion('pmos', model, 2.4, 0.18, 1, 1.8, 1.8, 1.8, 1.8);
    expect(cutoffResult.region).toBe('Cutoff');
  });
});
