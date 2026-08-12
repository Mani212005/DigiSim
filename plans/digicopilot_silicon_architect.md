# DigiCopilot Silicon Architecture Synthesis & Microcontroller Engine

## 1. Executive Summary & Vision
Rather than treating microcontrollers (e.g., Arduino ATmega328P, ESP32, ARM Cortex-M) as opaque, black-box PCB modules with pre-packaged header pins, **DigiSim** focuses on **Silicon IC & Analog/Digital Transistor-Level Design**.

Every microcontroller or complex mixed-signal SoC is fundamentally a hierarchical composition of analog reference circuits, CMOS standard cells, memory bitcells, and digital execution blocks. 

The **DigiCopilot Silicon Architecture Engine** acts as an AI silicon architect that teaches engineers and students how to build a microcontroller from scratch at the transistor and gate levels, and can generate hierarchical subcircuits on demand onto the DigiSim canvas.

---

## 2. Hierarchical Microcontroller Silicon Breakdown

```
                 +-----------------------------------------------+
                 |             MICROCONTROLLER CORE             |
                 +-----------------------------------------------+
                                         |
     +-------------------+---------------+-------------------+
     |                   |                                   |
+----+----+         +----+----+                         +----+----+
| DIGITAL |         | MEMORY  |                         | ANALOG  |
| CORE    |         | BLOCKS  |                         | BLOCKS  |
+----+----+         +----+----+                         +----+----+
     |                   |                                   |
     |-- 8-bit/32-bit    |-- 6T CMOS SRAM Bitcells           |-- Bandgap Voltage Reference (1.2V)
     |   ALU             |-- Sense Amplifiers                |-- Crystal Pierce Oscillator (16MHz)
     |-- Program Counter |-- Row/Column Address Decoders     |-- Low-Dropout (LDO) Regulator
     |-- Instruction Reg |-- Flash/ROM Matrix                |-- 10-bit SAR ADC Ladder
     |-- D-Flip-Flop Regs                                    |-- Analog Comparator
```

### Key Subcircuit Primitives:
1. **Arithmetic Logic Unit (ALU)**:
   - Built from 1-bit full adders (`XOR`, `NAND`, `NOR`), bitwise multiplexers (Transmission Gates), and carry-lookahead chains.
2. **6T CMOS SRAM Cell**:
   - 2 cross-coupled CMOS inverters ($M_1, M_2, M_3, M_4$) + 2 NMOS access pass transistors ($M_5, M_6$) gated by Wordline ($WL$), driving Bitline ($BL$) and Bitline-Bar ($\overline{BL}$).
3. **Silicon Bandgap Reference (BGR)**:
   - Brokaw or Kuijk bandgap reference built from NPN/PNP substrate BJTs, proportional-to-absolute-temperature (PTAT) resistors, and a CMOS error amplifier to generate a process- and temperature-invariant $1.20\text{V}$ reference.
4. **Pierce Crystal Oscillator / Ring Oscillator**:
   - Odd number of CMOS inverter stages with load capacitors and feedback resistor to generate high-frequency on-chip clock pulses.
5. **Successive Approximation Register (SAR) ADC**:
   - R-2R binary ladder or binary-weighted capacitor array, CMOS analog comparator differential pair, and successive approximation register logic.

---

## 3. DigiCopilot Interaction & Synthesis Workflow

1. **Natural Language Inquiry**:
   - User: *"I want to learn how an Arduino / microcontroller is actually built from silicon transistors. Can you help me build the arithmetic unit and clock?"*
2. **Pedagogical Explanation**:
   - DigiCopilot explains the physical transistor topology (e.g., CMOS complementary pull-up PMOS and pull-down NMOS networks, transistor sizing for equal rise/fall times).
3. **1-Click Hierarchical Subcircuit Synthesis**:
   - DigiCopilot generates the complete subcircuit schematic (e.g. `CellRegistry.registerCell('SRAM_6T', ...)` or `CellRegistry.registerCell('ALU_1BIT', ...)`).
   - Places the hierarchical cell on the ReactFlow canvas, allowing the user to double-click into the subcircuit or simulate the full MNA transient response.
4. **Silicon Process Portability**:
   - Supports retargeting between `350nm`, `180nm`, `90nm`, `45nm`, and `28nm FinFET` PDKs with automated $W/L$ scaling.

---

## 4. Implementation Roadmap (Post-Core EDA Phase)
- **Phase A**: Primitive Silicon Expansion (BJTs, Capacitors, Inductors, Pulse Clocks, Transmission Gates, 350nm/45nm PDKs) — *Current Phase*.
- **Phase B**: Hierarchical Cell Subcircuit Library (6T SRAM, ALU-1bit, Op-Amp, Bandgap, Ring Oscillator) in `CellRegistry`.
- **Phase C**: DigiCopilot Natural Language Synthesis Prompts and Schema verification.
