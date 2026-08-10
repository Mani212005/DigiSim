/**
 * @file PDKManager.ts
 * @description PDK Manager for 180nm CMOS, 90nm CMOS, and 28nm HKMG process design kits.
 * Provides BSIM model cards, CDF layout parameter calculations (ad, as, pd, ps),
 * and transistor operating region / drain current calculation algorithms.
 */

import type {
  BSIMModelCard,
  CDFParameters,
  MosfetOutputs,
  MosfetType,
  OperatingRegion,
  TechNode,
} from '../../types/pdk';

const EPSILON_0 = 8.854e-12; // F/m
const EPSILON_SIO2 = 3.9 * EPSILON_0; // F/m
const EPSILON_HK = 20.0 * EPSILON_0; // High-k dielectric F/m for 28nm HKMG

/** Pre-configured BSIM model cards for standard process nodes. */
const DEFAULT_MODEL_CARDS: Record<string, BSIMModelCard> = {
  '180nm_nmos': {
    name: 'BSIM3v3_180nm_NMOS',
    techNode: '180nm',
    type: 'nmos',
    Vth0: 0.45,
    mu0: 450, // cm^2 / V·s
    Tox: 4.1e-9, // 4.1 nm
    gamma: 0.4,
    lambda: 0.05,
    S: 80, // mV/dec
    Cox: EPSILON_SIO2 / 4.1e-9, // ~8.41 e-3 F/m^2
    Vdd: 1.8,
  },
  '180nm_pmos': {
    name: 'BSIM3v3_180nm_PMOS',
    techNode: '180nm',
    type: 'pmos',
    Vth0: -0.45,
    mu0: 120, // cm^2 / V·s
    Tox: 4.1e-9,
    gamma: 0.4,
    lambda: 0.06,
    S: 82,
    Cox: EPSILON_SIO2 / 4.1e-9,
    Vdd: 1.8,
  },
  '90nm_nmos': {
    name: 'BSIM4_90nm_NMOS',
    techNode: '90nm',
    type: 'nmos',
    Vth0: 0.35,
    mu0: 350,
    Tox: 2.2e-9, // 2.2 nm
    gamma: 0.3,
    lambda: 0.1,
    S: 85,
    Cox: EPSILON_SIO2 / 2.2e-9, // ~1.57 e-2 F/m^2
    Vdd: 1.2,
  },
  '90nm_pmos': {
    name: 'BSIM4_90nm_PMOS',
    techNode: '90nm',
    type: 'pmos',
    Vth0: -0.35,
    mu0: 90,
    Tox: 2.2e-9,
    gamma: 0.3,
    lambda: 0.12,
    S: 88,
    Cox: EPSILON_SIO2 / 2.2e-9,
    Vdd: 1.2,
  },
  '28nm_nmos': {
    name: 'BSIMIMG_28nm_HKMG_NMOS',
    techNode: '28nm',
    type: 'nmos',
    Vth0: 0.28,
    mu0: 250,
    Tox: 1.1e-9, // 1.1 nm equivalent oxide thickness
    gamma: 0.2,
    lambda: 0.18,
    S: 90,
    Cox: EPSILON_HK / 1.1e-9,
    Vdd: 0.9,
  },
  '28nm_pmos': {
    name: 'BSIMIMG_28nm_HKMG_PMOS',
    techNode: '28nm',
    type: 'pmos',
    Vth0: -0.28,
    mu0: 60,
    Tox: 1.1e-9,
    gamma: 0.2,
    lambda: 0.2,
    S: 92,
    Cox: EPSILON_HK / 1.1e-9,
    Vdd: 0.9,
  },
};

/** Minimum diffusion contact length per process node in micrometers (um). */
const L_DIFF_BY_TECH: Record<TechNode, number> = {
  '180nm': 0.36,
  '90nm': 0.2,
  '28nm': 0.1,
};

export class PDKManagerClass {
  private modelCards: Map<string, BSIMModelCard> = new Map();

  constructor() {
    Object.entries(DEFAULT_MODEL_CARDS).forEach(([key, card]) => {
      this.modelCards.set(key, card);
    });
  }

  /**
   * Retrieve a BSIM model card for a given process node and transistor type.
   */
  public getModelCard(techNode: TechNode, type: MosfetType): BSIMModelCard {
    const key = `${techNode}_${type}`;
    const card = this.modelCards.get(key);
    if (!card) {
      return DEFAULT_MODEL_CARDS[`180nm_${type}`];
    }
    return card;
  }

  /**
   * Register a custom BSIM model card.
   */
  public registerModelCard(card: BSIMModelCard): void {
    const key = `${card.techNode}_${card.type}`;
    this.modelCards.set(key, card);
  }

  /**
   * Calculate CDF (Component Description Format) parameters for transistor layout geometry.
   *
   * @param techNode - Process technology node ('180nm' | '90nm' | '28nm')
   * @param W - Total transistor width in microns (um)
   * @param L - Channel length in microns (um)
   * @param nf - Number of fingers (default: 1)
   * @returns Calculated ad, as, pd, ps in micrometers^2 / micrometers
   */
  public calculateCDF(techNode: TechNode, W: number, L: number, nf = 1): CDFParameters {
    const safeNf = Math.max(1, Math.floor(nf));
    const safeW = Math.max(0.01, W);
    const wFinger = safeW / safeNf;
    const ldiff = L_DIFF_BY_TECH[techNode] ?? 0.36;

    // Drain/Source diffusion area (um^2) and perimeter (um)
    const ad = Number((wFinger * ldiff).toFixed(4));
    const as = Number((wFinger * ldiff).toFixed(4));
    const pd = Number((2 * wFinger + 2 * ldiff).toFixed(4));
    const ps = Number((2 * wFinger + 2 * ldiff).toFixed(4));

    return { ad, as, pd, ps };
  }

  /**
   * Calculate MOSFET drain current and operating region (Cutoff, Triode, Saturation)
   * using BSIM level 1 / level 3 equations with body effect and channel length modulation.
   *
   * @param type - Transistor type ('nmos' | 'pmos')
   * @param model - BSIM model card
   * @param W - Width in microns (um)
   * @param L - Length in microns (um)
   * @param nf - Number of fingers
   * @param vd - Drain terminal voltage (V)
   * @param vg - Gate terminal voltage (V)
   * @param vs - Source terminal voltage (V)
   * @param vb - Bulk terminal voltage (V)
   */
  public calculateOperatingRegion(
    type: MosfetType,
    model: BSIMModelCard,
    W: number,
    L: number,
    nf: number,
    vd: number,
    vg: number,
    vs: number,
    vb: number
  ): MosfetOutputs {
    const cdf = this.calculateCDF(model.techNode, W, L, nf);
    const safeL = Math.max(0.001, L);
    const safeW = Math.max(0.001, W);
    const wOverL = safeW / safeL;

    // Convert mobility from cm^2/V-s to m^2/V-s
    const mu0_m2 = model.mu0 * 1e-4;
    // Process transconductance parameter K' = mu0 * Cox (A / V^2)
    const K_prime = mu0_m2 * model.Cox;
    const beta = K_prime * wOverL;

    const phiF = 0.3; // Fermi potential approximation (2*phiF = 0.6V)
    const twoPhiF = 2 * phiF;

    if (type === 'nmos') {
      const vgs = vg - vs;
      const vds = vd - vs;
      const vsb = vs - vb;

      // Threshold voltage with body effect: Vth = Vth0 + gamma*(sqrt(2phiF + Vsb) - sqrt(2phiF))
      let vth = model.Vth0;
      if (vsb > 0) {
        vth += model.gamma * (Math.sqrt(twoPhiF + vsb) - Math.sqrt(twoPhiF));
      }

      const vov = vgs - vth; // Overdrive voltage

      let region: OperatingRegion = 'Cutoff';
      let ids = 0;

      if (vov <= 0) {
        region = 'Cutoff';
        ids = 0;
      } else if (vds < vov) {
        region = 'Triode';
        ids = beta * (vov * vds - (vds * vds) / 2) * (1 + model.lambda * vds);
      } else {
        region = 'Saturation';
        ids = 0.5 * beta * (vov * vov) * (1 + model.lambda * vds);
      }

      return {
        region,
        ids: Math.max(0, ids),
        vgs,
        vds,
        vsb,
        vth,
        cdf,
      };
    } else {
      // PMOS Transistor Equations
      const vsg = vs - vg;
      const vsd = vs - vd;
      const vbs = vb - vs;

      const vth0_abs = Math.abs(model.Vth0);
      let vth_abs = vth0_abs;
      if (vbs > 0) {
        vth_abs += model.gamma * (Math.sqrt(twoPhiF + vbs) - Math.sqrt(twoPhiF));
      }
      const vth = -vth_abs;

      const vov = vsg - vth_abs;

      let region: OperatingRegion = 'Cutoff';
      let ids = 0;

      if (vov <= 0) {
        region = 'Cutoff';
        ids = 0;
      } else if (vsd < vov) {
        region = 'Triode';
        ids = beta * (vov * vsd - (vsd * vsd) / 2) * (1 + model.lambda * vsd);
      } else {
        region = 'Saturation';
        ids = 0.5 * beta * (vov * vov) * (1 + model.lambda * vsd);
      }

      return {
        region,
        ids: Math.max(0, ids),
        vgs: -vsg,
        vds: -vsd,
        vsb: -vbs,
        vth,
        cdf,
      };
    }
  }
}

export const PDKManager = new PDKManagerClass();
