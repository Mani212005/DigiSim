# DigiSim — Conceptual Sketch & Engineering Blueprint Frontend Implementation Plan

## 1. Executive Summary & Approval
* **Approved By**: Captain
* **UX Prototype**: `.lavish/digisim_conceptual_sketch.html` (Reviewed & Approved)
* **Goal**: Implement the **Conceptual Sketch & Engineering Blueprint** design system across the DigiSim React frontend (`projects/DigiSim/frontend/`), permanently eliminating the broken vertical pill popup and bringing a unified CAD drafting aesthetic with dark navy grids, glowing cyan logic wires, and a dockable technical HUD Inspector.

---

## 2. Problem Statement (Identified UI Defects)
1. **Broken Vertical Pill Popup**: The old node modal lacked horizontal width constraints and stretched vertically through the center of the canvas, cutting off warning text (`Analog ... rive gates yet — co ... S3)`) and occluding node ports.
2. **Design Fragmentation**: The canvas lacked consistent visual hierarchy between logic gates, arithmetic blocks, sequential flip-flops, and hardware pins.

---

## 3. Design System & CSS Architecture
* **Theme Tokens**:
  - Drafting Canvas: `--bg-blueprint: #070B12;` with 24px/120px dot grid lines.
  - Surface Elevation: `--bg-surface: #0E1524;`, `--bg-card: rgba(14, 21, 36, 0.85);`
  - Border Accents: `--border-cad: #1C2B45;`, `--border-focus: #00F0FF;`
  - Signal States:
    - High (Logic 1): `--accent-cyan: #00F0FF;` with subtle glow.
    - Low (Logic 0): `--accent-dim: #1A3045;`
    - Clock/Pulse: `--accent-amber: #FFB300;`
    - Error/Short-Circuit: `--accent-coral: #FF476E;`
    - Analog Level: `--accent-green: #00E676;`
* **Typography**:
  - Primary UI: `Plus Jakarta Sans`, sans-serif.
  - Pinouts, Voltages, Netlist & CAD labels: `Fira Code`, monospace.

---

## 4. Component Implementation Phases

### Phase 1: Cleanse & Replace Broken Popup (`src/components/InspectorPanel.tsx`)
- [ ] Replace unconstrained vertical popup modal with the **Docked Technical HUD Inspector** (320px width).
- [ ] Anchor popovers cleanly to the top-right viewport or relative to node bounding boxes with guaranteed min/max boundaries.
- [ ] Add structured diagnostic warning cards with clear hardware constraints (e.g. `⚠️ Analog signals cannot directly drive pure CMOS gates without an ADC buffer`).
- [ ] Include one-click resolution action: `✓ Auto-Insert ADC Buffer`.

### Phase 2: Refactor Logic Nodes & Wire Physics (`src/nodes/GateShell.tsx`)
- [ ] Render CAD-grade vector glyphs (74xx Series AND, OR, NOT, NAND, NOR, XOR, XNOR).
- [ ] Support active signal pulsing on input/output handles.
- [ ] Add compact node header tags (e.g. `U1: AND • 74HC08`) and live pin voltage readouts.

### Phase 3: Blueprint Sidebar & Palette (`src/components/Sidebar.tsx`)
- [ ] Categorize components into:
  - 🔌 Logic Gates (74xx Series)
  - ⏱️ Sequential & Memory (D Flip-Flop, JK Flip-Flop, Clock Generator, 4-Bit Counter)
  - 📊 Probes & Displays (7-Segment, Oscilloscope, Truth Table)
  - 📷 Hand-Drawn Schematic Upload (YOLOv8 Vision OCR)
- [ ] Apply matching blueprint styling, search filtering, and drag-and-drop handles.

---

## 5. Verification & Testing Criteria
1. **Zero Layout Distortion**: Inspect all modal and popover overlays across screen sizes (1280px, 1440px, 1920px) to ensure no vertical clipping or unconstrained stretching occurs.
2. **TypeScript & Build**: `npm run build` must compile with 0 errors and 0 type issues.
3. **Netlist & Backend Communication**: Verify JSON netlist compilation and AI gate detection over `http://localhost:5001`.
