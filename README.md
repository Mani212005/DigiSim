# DigiSim: Ultra-Modern Digital Logic & Schematic Circuit Simulator

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-cyan.svg)](https://react.dev/)
[![ReactFlow](https://img.shields.io/badge/ReactFlow-11-purple.svg)](https://reactflow.dev/)
[![Python](https://img.shields.io/badge/Python-3.14-yellow.svg)](https://www.python.org/)
[![YOLOv8](https://img.shields.io/badge/YOLOv8-Ultralytics-000000.svg)](https://docs.ultralytics.com/)

**DigiSim** is an interactive, browser-based digital logic circuit simulator that combines **manual drag-and-drop circuit creation** with **automated ML-based image-to-circuit detection**. 

Build and simulate logic circuits manually on a dark glassmorphic canvas, or upload a picture/schematic of a circuit to let DigiSim automatically detect the gates, trace the wires, and construct the interactive circuit for you.

---

## ⚡ Key Features

- **⚡ Glassmorphic Dark UI (v2.0 Pro)**: Ultra-modern, responsive dark layout (`#0B0F19`) with glowing status indicators, translucent navbars, and custom ReactFlow node styling.
- **🎨 Consolidated Component Library**: Categorized drag-and-drop sidebar featuring logic gates (AND, OR, NAND, NOR, XOR, XNOR, NOT), IO controls (Toggle Switches, LED Probes, Clock Signals), and Analog components.
- **🔍 ⌘K Component Search**: Instant search and filtering across the entire component palette.
- **⚙️ Real-time Simulation Engine**: Topological Kahn's algorithm sorting for digital gates and Modified Nodal Analysis (MNA) solver for analog nodes with live signal propagation (HIGH/LOW/Z/X).
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

### 4. Model Context Protocol (MCP) Server Setup
Register the stdio DigiSim MCP server with Claude Desktop or AGY / Cursor by adding this entry to your `mcpServers` configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "digisim": {
      "command": "uv",
      "args": ["run", "python", "backend/mcp_server.py"],
      "cwd": "/path/to/DigiSim"
    }
  }
}
```

The MCP server exposes the following tools:
- `digisim_create_circuit`: Generate a DigiSim schematic from a JSON netlist.
- `digisim_simulate_mna`: Execute MNA / SPICE simulation and return node voltages & waveforms.
- `digisim_detect_circuit_photo`: Run YOLO detection on base64 image input.
- `digisim_export_spice`: Generate SPICE netlist text from canvas JSON.

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

## 📄 License

Distributed under the MIT License. See `LICENSE` for details.

