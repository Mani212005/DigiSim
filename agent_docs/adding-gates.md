# Adding a New Gate Type (transistor-first)

DigiSim no longer adds ready-made gate primitives to the palette. To add a new
gate, build it from transistors and package it as a reusable cell.

## Workflow

### 1. Build from transistors on the canvas
Place NMOS/PMOS (Transistors tab), a Voltage Source (VDD), Ground, Inputs and
an Output. Wire complementary CMOS and confirm the truth table in the terminal
panel (switch-level solver in `frontend/src/logic/simulation/switchLevel.ts`).

### 2. Package as a cell
Drag-select the gate transistors + supplies + I/O, click **Package** in the
selection toolbar, and save it (e.g. `XNOR`) to My Library. Cells persist in
`localStorage` (`customComponents`) across reloads.

### 3. Seed (only for built-in standard cells)
Built-in cells live in `frontend/src/logic/library/standardCells.ts` with
stable `std-*` ids. NOT/NAND/NOR are direct CMOS; AND/OR/XOR nest those cells
(AND = NAND+NOT, OR = NOR+NOT, XOR = 4x NAND) to prove hierarchy. Seeding is
versioned/idempotent via `ensureStandardCellsSeeded()`.

## Truth Tables for Reference
| Gate | 2-input logic |
|------|--------------|
| AND  | A & B |
| OR   | A \| B |
| NAND | !(A & B) |
| NOR  | !(A \| B) |
| XOR  | A ^ B |
| XNOR | !(A ^ B) |
| NOT  | !A (1 input only) |

## Legacy compatibility (do not extend)
Old `andGate`/`nandGate`/… node types in `App.tsx nodeTypes` plus
`logic/simulation/evaluateGate.ts` exist only so saved circuits using the
retired primitives still load and simulate. Never add a new primitive type.

## Checklist Before Marking Done
- [ ] Cell simulates to the correct truth table (`standardCells.test.ts` pattern)
- [ ] Cell drills down to transistors (no primitive gates inside seeds)
- [ ] `npm test -- --watchAll=false` → zero failures
