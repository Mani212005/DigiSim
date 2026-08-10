# DigiSim Transformation Plan: Ultimate AI-Native EDA Platform

## Executive Summary
This master plan defines the architectural transformation of **DigiSim** into an open-source, AI-native EDA platform combining the gold-standard capabilities of **Cadence Virtuoso**, **Altium Designer**, **KiCad**, **EasyEDA**, **Falstad**, and **QSPICE** with native AI co-piloting capabilities.

---

## 1. Competitor Pioneer Synthesis & Weakness Elimination

| Platform | Pioneer Strength Adopted | Industry Weakness Eliminated | DigiSim Implementation |
| :--- | :--- | :--- | :--- |
| **Cadence Virtuoso** | Spectre SPICE, 180nm/90nm/28nm PDKs, 4-terminal FETs | $50k–$100k/yr fees, 90s X11 UI, opaque PDK setup | Zero-install Cloud PDK Hub + WASM BSIM4 engine |
| **Synopsys Custom Compiler** | Visually assisted layout & constraint routing | Closed enterprise lock-in & steep migration | Open-source AI layout co-pilot |
| **Altium Designer** | 3D PCB visualization & multi-layer routing | $4k–$9k/yr fees, Windows-only, bad autorouter | WebGL 3D PCB view + WebGPU autorouting |
| **KiCad** | Push-and-shove interactive trace routing | No real-time multiplayer, manual file sharing | CRDT Figma-style live multi-user canvas with live cursors |
| **EasyEDA** | One-click JLCPCB manufacturing & cloud search | Vendor lock-in & poor multi-layer board speed | Open Gerber/BOM export + universal foundry connector |
| **Falstad** | Dynamic green-dot current & signal flow animation | Idealized math components; no SPICE/PCB layout | Falstad-style visual flow on top of true SPICE BSIM4 accuracy |
| **QSPICE** | Ultra-fast mixed-signal simulation engine | Windows desktop binary with zero cloud or AI layer | WASM SIMD C++/Verilog JIT engine running in browser |

---

## 2. Architecture & Subsystem Specification

### A. PDK Manager Subsystem (`frontend/src/logic/pdk/PDKManager.ts`)
- **Foundry Nodes**:
  - **180nm Bulk CMOS** ($V_{DD}=1.8\text{V}$, $L_{min}=180\text{nm}$, $T_{ox}=4.0\text{nm}$)
  - **90nm Strained CMOS** ($V_{DD}=1.2\text{V}$, $L_{min}=90\text{nm}$, $T_{ox}=2.2\text{nm}$)
  - **28nm HKMG** ($V_{DD}=0.9\text{V}$, $L_{min}=28\text{nm}$, $T_{ox}=1.2\text{nm}$)
- **BSIM Model Cards**: $V_{th0}, \mu_0, T_{ox}, \gamma, \lambda, S$.
- **CDF Parameter Calculator**: Automatic calculation of $ad, as, pd, ps$ from finger count ($nf$), width ($W$), and length ($L$).

### B. 4-Terminal MOSFET Primitives (`frontend/src/components/nodes/NmosNode.tsx`, `PmosNode.tsx`)
- Explicit Drain (D), Gate (G), Source (S), and Bulk/Body (B) handles.
- Auto-bulk fallback to $V_{SS}$ or $V_{DD}$ in Basic Mode; custom body-bias ($V_{sb}$) in Advanced Mode.
- Live canvas badges displaying operating region (*Cutoff*, *Triode*, *Saturation*), $V_{gs}$, $V_{ds}$, and $I_d$.

### C. OpenAccess Cell/Cellview Hierarchy (`frontend/src/logic/hierarchy/CellRegistry.ts`, `SubcktNode.tsx`)
- Cellviews: `schematic`, `symbol`, `spice`.
- Sub-circuit parameter pass-through (`PARAMS: W_p=1.2u`) and double-click push-pop canvas drill-down.

### D. Dual SPICE & Non-Linear MNA Solver (`frontend/src/logic/simulation/mnaSpice.ts`, `netlistSpice.ts`)
- Emits standard SPICE (.cir) and Spectre native syntax.
- Dual-Tier WASM Solver: Tier 1 high-speed WASM BSIM-Lite solver + Tier 2 WASM Ngspice / PySPICE bridge.
- Robust convergence: Damped Newton-Raphson voltage stepping ($\Delta V_{gs} \le 0.2\text{V}$), $G_{min}$ stepping, and source stepping.

### E. Falstad Signal Flow & 3D PCB View (`frontend/src/components/canvas/FalstadFlowOverlay.tsx`, `Pcb3DViewer.tsx`)
- Animated green-dot current flow on canvas wires backed by BSIM4 SPICE current vectors.
- Interactive WebGL 3D PCB multi-layer view.

### F. DigiCopilot AI EDA Assistant (`frontend/src/components/hud/DigiCopilotPanel.tsx`)
- Natural language to netlist synthesis.
- Constraint-aware AI trace routing & component placement.
- Automated $W/L$ ratio optimization and multi-corner PVT checks.

---

## 3. Parallel Autonomous Implementation Checkpoints

- **Checkpoint 1: PDK Subsystem & 4-Terminal MOSFET Nodes** (`PDKManager.ts`, `NmosNode.tsx`, `PmosNode.tsx`)
- **Checkpoint 2: OpenAccess Cell Hierarchy & Sub-Circuits** (`CellRegistry.ts`, `SubcktNode.tsx`)
- **Checkpoint 3: Non-Linear SPICE Solver & Falstad Current Flow** (`mnaSpice.ts`, `netlistSpice.ts`, `FalstadFlowOverlay.tsx`)
- **Checkpoint 4: DigiCopilot AI EDA Assistant & HUD Integration** (`DigiCopilotPanel.tsx`, `Pcb3DViewer.tsx`)
