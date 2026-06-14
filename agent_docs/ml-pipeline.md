# ML Pipeline

## Goal
Photo of a circuit → structured JSON → DigiSim recreates the circuit automatically.

## 4 Stages (strictly sequential)
Image → [Stage 1: YOLO Detection] → [Stage 2: OpenCV Wire Extraction]

→ [Stage 3: NetworkX Graph] → [Stage 4: DigiSim JSON Export]

| Stage | File | Method | Output |
|-------|------|--------|--------|
| 1 | `backend/pipeline/detector.py` | YOLOv8 transfer learning | Bounding boxes + class labels |
| 2 | `backend/pipeline/wire_extractor.py` | OpenCV only — no neural net | Wire segments as pixel pairs |
| 3 | `backend/pipeline/graph_builder.py` | NetworkX DiGraph | Directed circuit graph |
| 4 | `backend/pipeline/circuit_exporter.py` | JSON serialization | DigiSim-importable JSON |

## Training Phases

| Phase | Classes Active | Stages Active | Threshold |
|-------|---------------|---------------|-----------|
| 1 | AND, OR, NOT | 1 only | F1 ≥ 0.95, acc ≥ 0.95 per class |
| 2 | All 12 | 1 only | same |
| 3 | All 12 | 1 + 2 + 3 | same |
| 4 | All 12 | 1 + 2 + 3 + 4 | same |

All 12 classes: `AND OR NOT NAND NOR XOR XNOR Switch Input Output LED Junction`

Current phase: `ml/experiments/current_phase.txt`

## Dataset
- **Source:** Synthetic screenshots from DigiSim (primary) + hand-drawn images (supplement)
- **Generation:** `backend/data_gen/screenshot_pipeline.py`
- **Augmentation:** `backend/data_gen/augmentation.py`
- **Minimum size:** Phase 1 → 500 images. Phase 2+ → 2000 images
- **Format:** YOLO `.txt` per image — `<class_id> <x_center> <y_center> <width> <height>` (normalized)
- **Class balance:** no class under 10% — check before every training run

## Key Principle
Dataset quality > annotation correctness > pipeline correctness > model architecture.
Fix data before changing models.

## Tech Stack
| Component | Tool |
|-----------|------|
| ML framework | PyTorch |
| Detection | YOLOv8 (ultralytics), pretrained COCO weights |
| Image processing | OpenCV |
| Graph | NetworkX |
| Training | Google Colab T4 |
| Inference | Local / Azure |

## What We Are NOT Doing
- Training from random weights
- Using a neural net for wire extraction
- One end-to-end model for image → circuit
- Using only hand-drawn images as the dataset