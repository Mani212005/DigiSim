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

## Class Vocabulary
Single source of truth: `ml/classes.yaml` (name, tier, YOLO id, frontend node type, terminals, default size, legacy aliases).
Never hand-edit the generated files; after editing the YAML run `cd ml && uv run python class_schema.py generate`
(`check` verifies nothing is stale; pytest `backend/test_class_schema.py` and Jest `yoloClassMap.test.ts` assert the backend and frontend maps equal the YAML).

| Tier | Classes (YOLO ids in file order) |
|------|----------------------------------|
| A (required, 14) | `NMOS PMOS VDD GND INPUT_PORT OUTPUT_PORT JUNCTION AND OR NOT NAND NOR XOR XNOR` |
| B (next, analog) | `RESISTOR CAPACITOR INDUCTOR BJT_NPN BJT_PNP CLOCK` |

Generated: `backend/pipeline/class_map.py` (`CLASS_TO_NODE_TYPE`, re-exported by `detector.py`),
`frontend/src/logic/vision/yoloClassMap.generated.ts` (`YOLO_CLASS_MAP`), dataset `data.yaml`
(`class_schema.py data-yaml --path DIR`, tier A by default; `screenshot_pipeline.py` uses the same renderer).

Legacy aliases (old 12-class gate-era weights): `SWITCH`, `INPUT` -> `INPUT_PORT`; `OUTPUT`, `LED` -> `OUTPUT_PORT`;
the gate names and `JUNCTION` are unchanged. Old weights emit these names upper-case, matching the alias keys.
Legacy ids differ from the canonical ids, so the frontend ONNX decoder uses `legacy_order` from `classes.yaml`
(AND=0 ... JUNCTION=11) when the model output has exactly 12 classes, and the canonical order otherwise.
The backend is unaffected because it reads class names from the model weights.

## Training Phases

| Phase | Classes Active | Stages Active | Threshold |
|-------|---------------|---------------|-----------|
| 1 | NMOS, PMOS, VDD, GND | 1 only | F1 >= 0.95, acc >= 0.95 per class |
| 2 | All 14 tier A | 1 only | same on synthetic held-out-style test; real held-out set F1 >= 0.85 per class with >= 30 test instances; JUNCTION recall >= 0.90 |
| 3 | All 14 tier A | 1 + 2 + 3 | same |
| 4 | All 14 tier A | 1 + 2 + 3 + 4 | same |

Tier B classes are trained after phase 4.

Current phase: `ml/experiments/current_phase.txt`

## Evaluation (harness v2)
`cd ml && uv run python evaluate.py --weights W.pt --data DATASET/data.yaml --frozen-name NAME` writes one JSON and one Markdown report
(`ml/experiments/eval/<run>.json|.md`, gitignored) with:
- **Detection:** per-class and per-domain precision / recall / F1 / accuracy with Wilson 95% CIs, confusion matrix, small-object (junction) recall,
  at one operating confidence (default 0.35). "accuracy" = TP / GT instances of the class (the phase-gate number). Domains come from the image file
  name prefix (`syn_` synthetic, `rf_` roboflow_real, `cghd_` cghd_real, `dss_` digisim_screenshot; add more with `--domain-rule PREFIX=name`).
  Classes with fewer than 30 GT instances are labelled `low n` instead of judged. Models are scored in the dataset's vocabulary: predictions map by
  class name, then by legacy alias (`ml/classes.yaml`); predictions with no counterpart are counted as `unmapped`.
- **Legacy block:** the original ultralytics validation numbers (mAP, max-F1 per class, confusion-matrix accuracy); `--reproduce OLD_eval_test.json` checks them.
- **End-to-end (optional):** `--gt-netlists DIR --pred-netlists DIR` (files `<image stem>.json`, schema in `ml/eval_netlist.py`; T2 emits the ground truth,
  T8 must emit predictions in it) gives net precision/recall/F1 over pin pairs (MOSFET bulk pins unscored), netlist exact-match rate, and truth-table
  equivalence of the rebuilt circuit under DigiSim's own `simulate()` (`ml/sim_bridge/truth_table.cjs`; needs `cd frontend && npm install`; `--no-truth-table` skips it).
- **Frozen sets:** the SHA-256 of the split's images and labels directories as resolved from `data.yaml`, its netlists directory (`--gt-netlists` when given) and class names must equal the entry in `ml/frozen_sets.json`, otherwise the run exits 3 and writes nothing.
  Register a new set once with `--freeze --frozen-name NAME --freeze-note "..."`; tooling never overwrites an entry. `--freeze` exists because the hash check needs a
  recorded hash to compare against, and every later dataset task (T4 onwards) registers its frozen entry this way. A split with no registered set runs unchecked and the report says "(not frozen - unverified)".
- **Baselines:** `ml/baselines/gate12.json` is the old 12-class model on the gate-era test split (`gate12_test`); compare a new run with `--baseline ml/baselines/gate12.json`.

## Dataset
- **Source:** Synthetic screenshots from DigiSim (primary) + hand-drawn images (supplement)
- **Generation:** `backend/data_gen/screenshot_pipeline.py`
- **Augmentation:** `backend/data_gen/augmentation.py`
- **Minimum size:** Phase 1 → 500 images. Phase 2+ → 2000 images
- **Format:** YOLO `.txt` per image — `<class_id> <x_center> <y_center> <width> <height>` (normalized)
- **Class balance:** no class under 10% — check before every training run

### Real data and the frozen eval set (`ml/real_data/`)
Fetched and converted data live in `ml/data_real/` (gitignored); committed: scripts, `ml/data_manifest.json` (SHA-256 of every
image and label, split membership, per-split frozen hashes), `ml/REAL_DATA_REPORT.md` (per-class real counts vs the plan, with the
`real count too low, synthetic-only claim` flag for any class under 30 real test instances), `ml/DATA_LICENSES.md` and our own
labels in `ml/real_data/labels/`.
- Sources: CGHD pilot (drafters 16, 19, 20, 25, HF mirror pinned to a revision), the 46-image Roboflow export, and the 4 spare `Sampleimages/` (held-out qualitative split `heldout_qual`).
- Splits are by **drafter** (CGHD) or source image, never by image; the leakage check also compares content hashes and near-duplicate hashes.
- `transistor.fet` has no polarity in CGHD: NMOS/PMOS comes from `labels/fet_polarity.json` (our manual pass, propagated across photos); uncertain ones are not labels.
- Boxes that are not labels (unmapped classes, undecided transistors/terminals/supply symbols) are kept as ignore regions in `data_real/yolo/ignore/` so evaluation can mask them.
- Commands (from `ml/`): `python -m real_data.build fetch | sheets | convert | verify | report`; tests: `pytest tests`.
- The test split hash is frozen: change the pilot or the labels and `convert` produces a new hash, which is a new eval set (record it, do not tune on it).

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