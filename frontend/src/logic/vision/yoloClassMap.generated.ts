/**
 * @file yoloClassMap.generated.ts
 * @description AUTO-GENERATED from ml/classes.yaml by ml/class_schema.py - do not edit by hand.
 * Detector class vocabulary: canonical names by YOLO id, legacy aliases that old weights still
 * predict, and the class-to-node-type map. Regenerate with `cd ml && uv run python class_schema.py generate`.
 */

import type { YoloNodeType } from '../../types';

/** Canonical class names; the index is the YOLO class id. */
export const YOLO_CLASS_NAMES: readonly string[] = [
  'NMOS',
  'PMOS',
  'VDD',
  'GND',
  'INPUT_PORT',
  'OUTPUT_PORT',
  'JUNCTION',
  'AND',
  'OR',
  'NOT',
  'NAND',
  'NOR',
  'XOR',
  'XNOR',
  'RESISTOR',
  'CAPACITOR',
  'INDUCTOR',
  'BJT_NPN',
  'BJT_PNP',
  'CLOCK',
];

/** Legacy (gate-era) class names mapped to their canonical class. */
export const YOLO_CLASS_ALIASES: Record<string, string> = {
  SWITCH: 'INPUT_PORT',
  INPUT: 'INPUT_PORT',
  OUTPUT: 'OUTPUT_PORT',
  LED: 'OUTPUT_PORT',
};

/** Class name (canonical and legacy) mapped to the DigiSim ReactFlow node type. */
export const YOLO_CLASS_MAP: Record<string, YoloNodeType> = {
  NMOS: 'nmos',
  PMOS: 'pmos',
  VDD: 'vsource',
  GND: 'ground',
  INPUT_PORT: 'input',
  OUTPUT_PORT: 'output',
  JUNCTION: 'junction',
  AND: 'andGate',
  OR: 'orGate',
  NOT: 'notGate',
  NAND: 'nandGate',
  NOR: 'norGate',
  XOR: 'xorGate',
  XNOR: 'xnorGate',
  RESISTOR: 'resistor',
  CAPACITOR: 'capacitor',
  INDUCTOR: 'inductor',
  BJT_NPN: 'bjtNpn',
  BJT_PNP: 'bjtPnp',
  CLOCK: 'clockSource',
  SWITCH: 'input',
  INPUT: 'input',
  OUTPUT: 'output',
  LED: 'output',
};
