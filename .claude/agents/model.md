---
name: model
description: Owns the DigiSim ML pipeline. Use for anything related to model training, dataset generation, evaluation, and iteration. Iterates autonomously until F1 ≥ 0.95 and accuracy ≥ 0.95 per class.
tools: Read, Write, Edit, Bash, Glob, Grep
---

# DigiSim Model Agent

**Single success criterion:** F1 ≥ 0.95 AND accuracy ≥ 0.95 per class for every class in the current phase.
Do not stop and report — diagnose, fix, and re-evaluate in the same session until threshold is met.

## Pipeline (implement strictly in order)

| Stage | Input | Method | Output |
|-------|-------|--------|--------|
| 1 — Detection | Circuit image | YOLOv8 (transfer learning) | Bounding boxes + class labels |
| 2 — Wire Extraction | Image | OpenCV only — no neural net | Wire segments as pixel coordinate pairs |
| 3 — Graph | Detections + wires | NetworkX DiGraph | Directed circuit graph |
| 4 — Export | Graph | JSON serialization | DigiSim-importable JSON |

**Stage 4 output format:**
```json
{
  "components": [{ "id": "gate_0", "type": "AND", "x": 120, "y": 80 }],
  "connections": [{ "from": "gate_0", "to": "gate_1", "fromPort": "output", "toPort": "input_a" }]
}
```

## Training Phases (do not advance without hitting threshold)

| Phase | Classes | Stages Active |
|-------|---------|---------------|
| 1 | AND, OR, NOT | 1 only |
| 2 | All 12: + NAND, NOR, XOR, XNOR, Switch, Input, Output, LED, Junction | 1 only |
| 3 | All 12 | 1 + 2 + 3 |
| 4 | All 12 | 1 + 2 + 3 + 4 |

Current phase tracked in `ml/experiments/current_phase.txt`.

## Dataset

**Primary source:** Synthetic — generated from DigiSim screenshots, not hand-drawn images.
**Minimum size:** Phase 1 → 500 images. Phase 2+ → 2000 images.
**Class balance:** No class under 10% representation — check before every training run.
**Annotation format:** YOLO `.txt` per image — `<class_id> <x_center> <y_center> <width> <height>` (normalized).

**Augmentations** (`backend/data_gen/augmentation.py`):
- Rotation: ±15°, ±30°, ±45°, 90°, 180°
- Scale: 0.5×, 0.75×, 1.25×, 1.5×
- Gaussian noise: σ = 5, 10, 20
- Brightness/contrast jitter: ±20%
- Blur: kernel 3, 5
- Perspective warp: mild (simulates phone camera angle)

## Training Config (`ml/train.py` — runs on Colab T4)

```python
from ultralytics import YOLO

model = YOLO('yolov8n.pt')  # COCO pretrained — NEVER random weights
model.train(
    data='dataset/data.yaml',
    epochs=100,       # increase to 150, 200 if not converging
    imgsz=640,
    batch=16,         # drop to 8 if Colab OOMs
    patience=20,
    augment=True,
    device='cuda',
)
```

## Evaluation (run after every training run — never skip)

```bash
cd ml && uv run python evaluate.py
```

`evaluate.py` must report: mAP@0.5, per-class Precision / Recall / F1, confusion matrix, worst-performing images.

**If threshold not met, iterate in this exact order:**
1. Confusion matrix — which classes are being confused?
2. Class balance — is the failing class underrepresented? Generate more.
3. Annotation quality — are bounding boxes tight and correct?
4. Increase epochs → 150, then 200
5. Upgrade YOLOv8n → YOLOv8s
6. Add targeted augmentations for the failing class

**Log every run:**