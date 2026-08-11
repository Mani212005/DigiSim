/**
 * @file componentTooltipData.ts
 * @description Comprehensive metadata, mini descriptions, pin specifications,
 * and formula references for all digital, analog, MOSFET, and hierarchical components
 * in DigiSim. Rendered in Sidebar component hover tooltips and Command Palette.
 */

export interface ComponentTooltipInfo {
  name: string;
  category: string;
  description: string;
  pins: string;
  formula?: string;
  hint?: string;
}

export const COMPONENT_TOOLTIP_DATA: Record<string, ComponentTooltipInfo> = {
  input: {
    name: 'Logic Input Switch',
    category: 'DIGITAL I/O',
    description: 'Interactive toggle switch driving HIGH (1) or LOW (0) digital voltage level.',
    pins: '1 Pin: [Out Y]',
    formula: 'V_out ∈ { 0V (LOW), 5V (HIGH) }',
    hint: 'Click on canvas node to toggle bit',
  },
  output: {
    name: 'Logic Output Probe',
    category: 'DIGITAL I/O',
    description: 'Digital logic state monitor with real-time green glowing active LED indicator.',
    pins: '1 Pin: [In A]',
    formula: 'Probe State = Input Logic Level',
    hint: 'Connect wire to observe signal',
  },
  andGate: {
    name: 'AND Gate',
    category: 'LOGIC GATE',
    description: '2-Input logical conjunction. Output is HIGH only when both inputs A and B are HIGH.',
    pins: '3 Pins: [In A, In B, Out Y]',
    formula: 'Y = A · B  (A ∧ B)',
    hint: 'HIGH only if all inputs are 1',
  },
  orGate: {
    name: 'OR Gate',
    category: 'LOGIC GATE',
    description: '2-Input logical disjunction. Output is HIGH if at least one input is HIGH.',
    pins: '3 Pins: [In A, In B, Out Y]',
    formula: 'Y = A + B  (A ∨ B)',
    hint: 'HIGH if any input is 1',
  },
  notGate: {
    name: 'NOT Gate (Inverter)',
    category: 'LOGIC GATE',
    description: 'Single-input logic inverter. Inverts digital HIGH to LOW and vice versa.',
    pins: '2 Pins: [In A, Out Y]',
    formula: 'Y = ¬A  (A̅)',
    hint: 'Complementary CMOS inverter',
  },
  nandGate: {
    name: 'NAND Gate',
    category: 'UNIVERSAL GATE',
    description: '2-Input negated AND gate. Output is LOW only when both inputs are HIGH.',
    pins: '3 Pins: [In A, In B, Out Y]',
    formula: 'Y = ¬(A · B) = A̅ + B̅',
    hint: 'Universal logic building block',
  },
  norGate: {
    name: 'NOR Gate',
    category: 'UNIVERSAL GATE',
    description: '2-Input negated OR gate. Output is HIGH only when both inputs are LOW.',
    pins: '3 Pins: [In A, In B, Out Y]',
    formula: 'Y = ¬(A + B) = A̅ · B̅',
    hint: 'Universal logic building block',
  },
  xorGate: {
    name: 'XOR Gate',
    category: 'ARITHMETIC',
    description: '2-Input exclusive OR gate. Output is HIGH when inputs have differing logic levels.',
    pins: '3 Pins: [In A, In B, Out Y]',
    formula: 'Y = A ⊕ B = A·B̅ + A̅·B',
    hint: 'Parity bit & binary half-adder',
  },
  xnorGate: {
    name: 'XNOR Gate',
    category: 'ARITHMETIC',
    description: '2-Input exclusive NOR gate. Output is HIGH when both inputs are equal.',
    pins: '3 Pins: [In A, In B, Out Y]',
    formula: 'Y = ¬(A ⊕ B) = A·B + A̅·B̅',
    hint: 'Bit comparator & equivalence gate',
  },
  vsource: {
    name: 'DC Voltage Source',
    category: 'POWER & REF',
    description: 'Ideal constant DC potential source maintaining fixed voltage across terminals.',
    pins: '2 Pins: [Pos (+), Neg (-)]',
    formula: 'V(+) - V(-) = V_DC  (Default: 5.0V)',
    hint: 'Editable voltage parameter on canvas',
  },
  ground: {
    name: 'Circuit Ground (GND)',
    category: 'POWER & REF',
    description: 'Common 0V potential reference node. Establishes the datum voltage for MNA solver.',
    pins: '1 Pin: [GND (0V)]',
    formula: 'V_GND = 0.00 V (Datum Node)',
    hint: 'Reference node for analog matrix',
  },
  resistor: {
    name: 'Linear Resistor',
    category: 'ANALOG PASSIVE',
    description: 'Passive linear component dissipating electrical power according to Ohm\'s Law.',
    pins: '2 Pins: [Lead A, Lead B]',
    formula: 'V = I · R  (P = I² · R)',
    hint: 'Editable resistance value (Ω)',
  },
  potentiometer: {
    name: 'Potentiometer',
    category: 'VARIABLE PASSIVE',
    description: 'Three-terminal adjustable variable resistance divider with interactive wiper slider.',
    pins: '2 Pins: [Lead A, Lead B, Wiper]',
    formula: 'R_eff = (percent / 100) · R_max',
    hint: 'Adjust wiper slider from 0% to 100%',
  },
  led: {
    name: 'Light Emitting Diode',
    category: 'SEMICONDUCTOR',
    description: 'Diode with exponential I-V characteristic glowing with real-time branch current.',
    pins: '2 Pins: [Anode (+), Cathode (-)]',
    formula: 'I_D = I_S · (e^(V_D / n·V_T) - 1)  (V_F ≈ 1.9V)',
    hint: 'Glows according to MNA solver current',
  },
  analogSwitch: {
    name: 'SPST Analog Switch',
    category: 'ELECTROMECHANICAL',
    description: 'Single-pole single-throw switch. Click glyph directly on canvas to open/close.',
    pins: '2 Pins: [Terminal A, Terminal B]',
    formula: 'R_closed = 0.01Ω  |  R_open = 100MΩ',
    hint: 'Click glyph to toggle open / closed',
  },
  nmos: {
    name: 'NMOS Transistor',
    category: 'MOSFET (BSIM)',
    description: '4-Terminal N-Channel MOSFET with BSIM body effect, lambda channel length modulation, and CDF layout parameters.',
    pins: '4 Pins: [Drain (D), Gate (G), Source (S), Bulk (B)]',
    formula: 'I_D = ½ · μ_n·C_ox · (W/L) · (V_GS - V_th)² · (1 + λ·V_DS)',
    hint: '180nm / 90nm / 28nm PDK models',
  },
  pmos: {
    name: 'PMOS Transistor',
    category: 'MOSFET (BSIM)',
    description: '4-Terminal P-Channel MOSFET with BSIM body effect, lambda channel length modulation, and CDF layout parameters.',
    pins: '4 Pins: [Source (S), Gate (G), Drain (D), Bulk (B)]',
    formula: 'I_D = ½ · μ_p·C_ox · (W/L) · (V_SG - |V_th|)² · (1 + λ·V_SD)',
    hint: '180nm / 90nm / 28nm PDK models',
  },
  subckt: {
    name: 'Sub-Circuit Block',
    category: 'HIERARCHY & CELLS',
    description: 'OpenAccess hierarchical subcircuit block with instance parameter pass-through and push/pop navigation.',
    pins: 'Dynamic Pins: [Configured Ports]',
    formula: 'Schematic Hierarchy: Instance Params (W, L)',
    hint: 'Shift + Double Click to drill down',
  },
};
