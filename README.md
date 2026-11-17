# DigiSim: Ultra-Modern Digital Logic & Schematic Circuit Simulator

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-cyan.svg)](https://react.dev/)
[![ReactFlow](https://img.shields.io/badge/ReactFlow-11-purple.svg)](https://reactflow.dev/)
[![Python](https://img.shields.io/badge/Python-3.11+-yellow.svg)](https://www.python.org/)
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
  - **YOLOv8 Schematic Detection**: Detects schematic symbols and uses OpenCV line transforms (Hough) to extract wire paths into a NetworkX graph. See [Machine learning status](#-machine-learning-status) for what the detector currently recognises.
  - **DINOv2 Physical Board Analysis**: Physical board photo component recognition using DINOv2 embeddings and OCR.
- **📄 Human & LLM-Parsable Netlist JSON Schema**: Export and import circuits using an intuitive, semantic JSON format (`input_A.out -> and_1.a`) with 100% loss-free round-trip reconstruction.

---

## 🛠️ Tech Stack

### Frontend
- **Framework**: React 19, TypeScript
- **Canvas & Nodes**: ReactFlow v11
- **Styling**: Tailwind CSS v4, Glassmorphism, DaisyUI v5

### Backend (Image Recognition & Pipeline)
- **Engine**: Python 3.11+ (the Docker image uses 3.12), Flask, `uv`
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

## 🧠 Machine Learning Status

The image-to-circuit pipeline is four strictly sequential stages: YOLOv8 detection
(`backend/pipeline/detector.py`), classical OpenCV wire extraction
(`wire_extractor.py`, no neural network), NetworkX graph building
(`graph_builder.py`) and DigiSim JSON export (`circuit_exporter.py`). Details:
[`agent_docs/ml-pipeline.md`](agent_docs/ml-pipeline.md).

What is true today:

- **The detector has not caught up with the transistor-first app.** The only
  trained detector was built for the earlier gate-era vocabulary (12 classes:
  AND, OR, NOT, NAND, NOR, XOR, XNOR, Switch, Input, Output, LED, Junction).
  It does not recognise NMOS/PMOS transistors or supply symbols, and it detects
  nothing useful on transistor-level schematics.
- **Retraining on transistor-level classes is in progress.** The class schema
  (`ml/classes.yaml`) is in place; it still needs a synthetic transistor-level
  generator, real hand-drawn data (see [Data and licences](#-data-and-licences)),
  a GPU training run and net tracing that no longer assumes left-to-right gates. Until that lands,
  treat detection results on transistor schematics as unsupported.
- **Training is transfer learning only** (pretrained COCO weights, never random
  init), with the gate: F1 >= 0.95 and accuracy >= 0.95 per class before a phase
  advances. Training and evaluation entry points are `ml/train.py` and
  `ml/evaluate.py`.
- **Trained detector weights are not in git.** They are loaded from `MODEL_WEIGHTS_PATH`
  (see `backend/.env.example`); without them the detection endpoints cannot
  produce results.

---

## 📜 Data and Licences

| Item | Source | Licence | Notes |
|------|--------|---------|-------|
| `My First Project.yolov8/` (46 images, 6 gate classes) | Roboflow Universe, workspace `cirzer`, project `my-first-project-yz9wf`, exported 2026-06-15 | CC BY 4.0 (annotations) | Attribution required: "cirzer / my-first-project-yz9wf" via https://universe.roboflow.com/cirzer/my-first-project-yz9wf. The licence covers the annotations; some source images appear to be figures from the web and may carry their own licences, so do not redistribute the images as a public dataset. |
| Synthetic training images | Generated by `backend/data_gen/` | Project's own (intended MIT; no `LICENSE` file yet) | Produced by code in this repository; no third-party imagery. |
| CGHD (hand-drawn circuit diagrams, DFKI) | Zenodo record 15333233; pilot of 4 drafters fetched from the Hugging Face mirror (not vendored) | CC BY 4.0 per the Zenodo record | Real hand-drawn data for the frozen eval set. Not in this repository (only hashes, counts and our NMOS/PMOS labels are); keep attribution when used. The dataset's own repo and mirrors state conflicting licences, so follow the Zenodo terms. Details: [`ml/DATA_LICENSES.md`](ml/DATA_LICENSES.md). |

Tracked in git today: the Roboflow export above, both as the extracted folder
`My First Project.yolov8/` and as `My First Project.yolov8.zip`, and
`Sampleimages/` (51 files) whose provenance and licence are not documented
yet. Other datasets and generated data are not committed; weights, large
datasets and training runs stay out of git (see `.gitignore`).

### Third-party model licences

- **Ultralytics YOLOv8 / YOLO11 is licensed under AGPL-3.0.** The detector
  depends on the `ultralytics` package, and weights trained or fine-tuned with
  it are generally treated as derivative of it. If you run a modified
  DigiSim as a network service or redistribute it together with such weights,
  AGPL-3.0 obligations (offering the corresponding source to users) can apply,
  and they differ from this repository's intended MIT licence. Ultralytics sells an
  Enterprise licence as the alternative. Review this before any commercial or
  closed deployment; this note is not legal advice.
- **DINOv2** (physical board analysis) is distributed by Meta under Apache-2.0
  and is loaded through `torch.hub` at runtime.

---

## 📄 License

DigiSim's own code is intended to be MIT-licensed, but no `LICENSE` file is in
the repository yet, so no licence grant is in place until one is added.
Third-party models, datasets and their different terms are listed in
[Data and Licences](#-data-and-licences).

