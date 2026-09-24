# DigiSim: Ultra-Modern Digital Logic & Schematic Circuit Simulator

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-cyan.svg)](https://react.dev/)
[![ReactFlow](https://img.shields.io/badge/ReactFlow-11-purple.svg)](https://reactflow.dev/)
[![Python](https://img.shields.io/badge/Python-3.14-yellow.svg)](https://www.python.org/)
[![YOLOv8](https://img.shields.io/badge/YOLOv8-Ultralytics-000000.svg)](https://docs.ultralytics.com/)

**DigiSim** is an interactive, browser-based digital logic circuit simulator that combines **manual drag-and-drop circuit creation** with **automated ML-based image-to-circuit detection**. 

Build and simulate logic circuits manually on a dark glassmorphic canvas, or upload a picture/schematic of a circuit to let DigiSim automatically detect the gates, trace the wires, and construct the interactive circuit for you.

## 🔬 Transistor-first workflow (Cadence-style)

DigiSim no longer ships ready-made NOT/AND/OR/NAND/NOR/XOR primitives in the
palette. The base building blocks are **NMOS/PMOS transistors, supplies
(VDD/GND), digital inputs/outputs, and wires**:

1. Place NMOS/PMOS from **Transistors**, add a Voltage Source (VDD), Ground,
   two Inputs and one Output.
2. Wire a CMOS gate (e.g. NAND: 2× PMOS in parallel to VDD, 2× NMOS in series
   to GND, gates to A/B, drains to Y). The switch-level solver shows the
   correct truth table live in the terminal panel.
3. Drag-select the gate, click **Package** in the selection toolbar, name it
   (e.g. `NAND`), and save it to **My Library → Standard Cells**.
4. Reuse the cell anywhere — including inside another cell (e.g. an AND built
   from a NAND cell + a NOT cell). Double-click a cell to drill down to its
   transistors. Cells persist in `localStorage` across reloads.
5. My Library is pre-seeded with transistor-built **NOT, NAND, NOR** plus
   hierarchical **AND (NAND+NOT), OR (NOR+NOT), XOR (4× NAND)** — open any of
   them to inspect down to transistors.

Legacy note: canvases saved with the old `andGate`/`nandGate`/… primitives
still load, render, and simulate (hidden compatibility path), but new designs
should use the seeded cells or package their own.

---

## ⚡ Key Features

- **⚡ Glassmorphic Dark UI (v2.0 Pro)**: Ultra-modern, responsive dark layout (`#0B0F19`) with glowing status indicators, translucent navbars, and custom ReactFlow node styling.
- **🎨 Consolidated Component Library**: Categorized drag-and-drop sidebar featuring transistors (NMOS/PMOS), IO controls (Toggle Switches, LED Probes, Clock Signals), Analog components, and a personal **My Library** of transistor-built standard cells.
- **🔍 ⌘K Component Search**: Instant search and filtering across the entire component palette.
- **⚙️ Real-time Simulation Engine**: Relaxation-based digital gate evaluation, a switch-level CMOS solver (NMOS/PMOS + supplies resolve to correct truth tables), and Modified Nodal Analysis (MNA) solver for analog nodes with live signal propagation (HIGH/LOW/Z/X).
- **📸 ML Image-to-Circuit Detection**:
  - **YOLOv8 Schematic Detection**: Detects drawn logic gates and uses OpenCV line transforms (Hough) to extract wire paths into a NetworkX graph.
  - **DINOv2 Physical Board Analysis**: Physical board photo component recognition using DINOv2 embeddings and OCR.
- **📄 Human & LLM-Parsable Netlist JSON Schema**: Export and import circuits using an intuitive, semantic JSON format (`input_A.out -> and_1.a`) with 100% loss-free round-trip reconstruction.

---

## 🛠️ Tech Stack

### Frontend
- **Framework**: React 19, TypeScript
- **Canvas & Nodes**: ReactFlow v11
- **Styling**: Tailwind CSS v4, Glassmorphism, DaisyUI v5

### Backend (Image Recognition & Pipeline)
- **Engine**: Python 3.14, Flask, `uv`
- **Machine Learning**: Ultralytics YOLOv8, PyTorch, DINOv2, OpenCV, NetworkX

---

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/Mani212005/DigiSim.git
cd DigiSim
```

### 2. Run the Frontend (Port 3000)
```bash
cd frontend
npm install --legacy-peer-deps
npm start
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Run the Backend (Port 5001)
```bash
cd backend
uv sync
uv run python app.py
```

### 4. Model Context Protocol (MCP) Server Setup
See [DigiSim Model Context Protocol (MCP) Server](#-digisim-model-context-protocol-mcp-server) below for setup instructions and tool capabilities.

---

## 🔌 DigiSim Model Context Protocol (MCP) Server

DigiSim includes a stdio Model Context Protocol (MCP) server allowing AI agents (like Claude Desktop, Antigravity, and Cursor) to generate circuits, run MNA simulations, detect breadboard/schematic photos, and export SPICE netlists.

### Available MCP Tools
- `digisim_create_circuit`: JSON netlist to schematic generator.
- `digisim_simulate_mna`: Execute MNA / SPICE simulation and return node voltages & waveforms.
- `digisim_detect_circuit_photo`: Run YOLO detection on base64 image input.
- `digisim_export_spice`: Generate SPICE netlist text from canvas JSON.

### Registration Instructions
To register DigiSim's MCP server with Claude Desktop or Antigravity, add the following to your `claude_desktop_config.json` or MCP settings:

```json
{
  "mcpServers": {
    "digisim": {
      "command": "uv",
      "args": [
        "run",
        "--directory",
        "/absolute/path/to/DigiSim/backend",
        "python",
        "mcp_server.py"
      ]
    }
  }
}
```

---

## 🌐 Hosting

Live topology: static frontend on Vercel, Flask backend as a Docker container
on Render (API calls proxy through `vercel.json` rewrites). Click-through
deploy steps and required secrets: [`docs/deploy-vercel-render.md`](docs/deploy-vercel-render.md).

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for details.

