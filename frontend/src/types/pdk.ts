/**
 * @file pdk.ts
 * @description Types for PDK (Process Design Kit) model cards, BSIM transistor
 * parameters, CDF parameter calculations, and operating region states.
 */

export type TechNode = '180nm' | '90nm' | '28nm';
export type MosfetType = 'nmos' | 'pmos';
export type OperatingRegion = 'Cutoff' | 'Triode' | 'Saturation';

/** BSIM transistor model card parameters. */
export interface BSIMModelCard {
  name: string;
  techNode: TechNode;
  type: MosfetType;
  /** Zero-bias threshold voltage (V) */
  Vth0: number;
  /** Low-field mobility (cm^2 / V·s) */
  mu0: number;
  /** Gate oxide thickness (meters) */
  Tox: number;
  /** Body effect coefficient (V^0.5) */
  gamma: number;
  /** Channel length modulation parameter (V^-1) */
  lambda: number;
  /** Subthreshold swing parameter (mV/decade) */
  S: number;
  /** Oxide capacitance per unit area (F / m^2) */
  Cox: number;
  /** Nominal supply voltage (V) */
  Vdd: number;
}

/** CDF (Component Description Format) geometry parameters. */
export interface CDFParameters {
  /** Drain diffusion area (m^2) */
  ad: number;
  /** Source diffusion area (m^2) */
  as: number;
  /** Drain diffusion perimeter (m) */
  pd: number;
  /** Source diffusion perimeter (m) */
  ps: number;
}

/** Transistor instance parameters stored in node data. */
export interface MosfetParams {
  techNode: TechNode;
  type: MosfetType;
  /** Total Channel Width (microns or meters, stored in um for user input) */
  W: number;
  /** Channel Length (microns or meters, stored in um for user input) */
  L: number;
  /** Number of fingers */
  nf: number;
  /** Automatic bulk connection fallback to VSS (nmos) or VDD (pmos) */
  autoBulk: boolean;
  /** Calculated CDF parameters */
  cdf?: CDFParameters;
}

/** Solver outputs for a MOSFET transistor node. */
export interface MosfetOutputs {
  region: OperatingRegion;
  /** Drain current in Amperes */
  ids: number;
  /** Gate-Source voltage (V) */
  vgs: number;
  /** Drain-Source voltage (V) */
  vds: number;
  /** Source-Bulk voltage (V) */
  vsb: number;
  /** Effective threshold voltage accounting for body effect (V) */
  vth: number;
  /** Calculated CDF parameters */
  cdf: CDFParameters;
}
