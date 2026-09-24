# Simulation Engine

## Location
`frontend/src/logic/simulation/` (entry point: `index.ts`)

`frontend/src/hooks/useLogicSimulation.ts` is only a thin React hook wrapper exposing `simulateCircuit` to `App.tsx`.

## Architecture & Flow
On every canvas state change, `simulate(nodes, edges, timeSeconds)`:
1. **Digital Pass (`digital.ts`)**: Evaluates digital logic, hierarchical subcircuits (`customComponent`), and switch-level CMOS networks (`switchLevel.ts`).
2. **Island Partitioning (`islands.ts`)**: Splits the graph into connected subgraphs (digital, analog, or mixed).
3. **Analog Solve (`mna.ts`)**: Runs the Modified Nodal Analysis (MNA) DC solver on purely analog islands.
4. **Mixed Island Detection**: Flags unsupported direct analog-to-gate connections with a warning on the analog node.

## Digital Evaluation & Relaxation (`digital.ts`)
- Iterative relaxation loop (up to 50 iterations) to settle combinational feedback, latches, and subcircuits.
- Supports hierarchical subcircuit evaluation by looking up definitions in `localStorage` (`customComponents`).
- Dispatches legacy primitive gates via `evaluateGate.ts` for backwards compatibility.

## Switch-Level CMOS Solver (`switchLevel.ts`)
Transistor-first simulation treats NMOS (ON when gate=1) and PMOS (ON when gate=0) as ideal switches between drain and source terminals:
- Drivers: VDD (1), GND/VSS (0), clock sources, digital inputs, and custom cell output pins.
- Transistors in series/parallel propagate logic levels to output probes. Contending drivers resolve to `X`; undriven nodes float as `Z`.
- Enables transistor-level cells (NOT, NAND, NOR, etc.) to simulate to accurate truth tables without full analog SPICE.

## Adding New Gates
Do not add new primitive gate types. Build new gates from transistors (NMOS/PMOS + VDD/GND + I/O), test the truth table, and package them as reusable standard cells in **My Library** (see `@agent_docs/adding-gates.md`).

## Legacy Compatibility (`evaluateGate.ts`)
Lookup table dispatch for retired primitive gates (`andGate`, `orGate`, `notGate`, `nandGate`, `norGate`, `xorGate`, `xnorGate`) to ensure legacy saved circuits continue to load and simulate.
