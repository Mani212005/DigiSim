# ML Pipeline

## Goal
Photo of a circuit → structured JSON → DigiSim recreates the circuit automatically.

## 4 Stages (strictly sequential)
Image → [Stage 1: YOLO Detection] → [Stage 2: OpenCV Net Tracing (wire extraction)]

→ [Stage 3: NetworkX Net Graph] → [Stage 4: DigiSim JSON Export]

| Stage | File | Method | Output |
|-------|------|--------|--------|
| 1 | `backend/pipeline/detector.py` | YOLOv8 transfer learning | Boxes + class labels (+ optional per-terminal keypoints) |
| 2 | `backend/pipeline/net_tracer.py` (+ `ink.py`, `skeleton_graph.py`, `pin_assignment.py`, `label_attach.py`) | OpenCV/scikit-image only, no neural net | Components with resolved pins, undirected nets, labels |
| 3 | `backend/pipeline/graph_builder.py` | NetworkX bipartite component/net MultiGraph | Net-based circuit graph |
| 4 | `backend/pipeline/circuit_exporter.py` | JSON serialization | Schema 2 JSON (components with pins, nets, ReactFlow edges, legacy `connections`) |

## Net Tracing (stage 2)
- Ink is binarised against a morphological paper-background estimate; symbol boxes are erased (plus a margin), junction dots are kept;
  the wire ink is skeletonised into edges and branch clusters. A cluster whose centre lies in a `JUNCTION` box connects all its wires;
  a dotless 4-way cluster is a crossover (straight-through pairs only); any other branch point connects. VDD symbols share one global net,
  GND symbols another. Every threshold scales with the measured stroke width and the median symbol size (`TraceConfig`).
- Pins: wire ends at a symbol box are its contacts. With detector keypoints (`Detection.keypoints`: keypoint i = terminal i of the class in
  `ml/classes.yaml`, the contract for a T7 pose head) contacts are matched to keypoints; without them a classical rule set assigns terminals
  (MOSFET drain/source by electrical distance to the supply, gates by input side) and estimates the 8-way orientation.
- Labels: names beside ports and supplies are cropped and read with RapidOCR's recogniser; nets take their port's name.
- Bench: `cd backend && uv run python data_gen/generate_v2.py --count 300 --seed 1 --out DIR && uv run python bench_tracing.py --data DIR --truth-table`
  drives the tracer from perturbed ground-truth detections and scores it with `ml/eval_netlist.py` per render style (clean = cad/textbook,
  hand_drawn = hand/photo); it exits 1 unless net F1 >= 0.90 for both styles, exact match >= 70% clean / >= 50% hand-drawn, and p95 runtime < 2 s.
- Measured T2 results: 300 samples from `generate_v2.py --count 300 --seed 1` (held out from tuning, which used seed 7). Detections are
  perturbed ground truth (box edges N(0, 3% of side), keypoints N(0, 3% of short side), 2% of junction dots dropped), scored with
  `ml/eval_netlist.py`. These scores come from perturbed ground-truth detections because no trained detector for the new classes exists yet,
  so they bound the tracer, not the end-to-end photo pipeline.

  | Mode | Style (circuits) | Net F1 | Exact match | Truth-table match |
  |------|------------------|--------|-------------|-------------------|
  | Keypoints | clean (151) | 0.9995 | 99.3% | 99.3% |
  | Keypoints | hand-drawn (149) | 0.9989 | 98.7% | 98.7% |
  | Geometry fallback (no keypoints) | clean | 0.9897 | 88.7% | 92.0% (overall) |
  | Geometry fallback (no keypoints) | hand-drawn | 0.9799 | 86.6% | 92.0% (overall) |

  Keypoint mode overall truth-table match is 99.0%. Runtime per image: mean 0.12 s, p95 0.29 s, max 0.80 s (keypoints); p95 0.34 s (geometry fallback).
- Not yet: the T3 screenshot round-trip truth-table check is tracked as a T3/T8 follow-up (the T3 screenshot set does not exist yet). The
  frontend importer (T9) still reads only the legacy `connections` (gate-level); wiring transistor-level imports means consuming
  `nets`/`edges` (handles `t:`/`s:` + terminal) and `library_cell` in `App.tsx importCircuit`.

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
  When the dataset root has a `generate_v2` `manifest.json`, test images flagged `held_out_style` are reported as their own domain
  `<domain>_heldout_style` (for the synthetic test add `--domain-rule 0=synthetic`, since generator file names have no prefix).
  Classes with fewer than 30 GT instances are labelled `low n` instead of judged. Models are scored in the dataset's vocabulary: predictions map by
  class name, then by legacy alias (`ml/classes.yaml`); predictions with no counterpart are counted as `unmapped`.
- **Ignore regions:** when the split has a sibling `ignore/` folder (T4 real data), an unmatched prediction with at least half its area inside an
  `uncertain_fet`, `uncertain_supply` or `uncertain_terminal` box is not counted as a false positive (objects T4 could not label);
  `unmapped` regions stay scored. `--ignore-reason none` disables it; the report states how many predictions were masked.
- **Legacy block:** the original ultralytics validation numbers (mAP, max-F1 per class, confusion-matrix accuracy); `--reproduce OLD_eval_test.json` checks them.
- **End-to-end (optional):** `--gt-netlists DIR --pred-netlists DIR` (files `<image stem>.json`, schema in `ml/eval_netlist.py`; the T2 generator's
  pin-map netlists are read as ground truth directly, and the stage 4 exporter output is a valid prediction) gives net precision/recall/F1 over pin pairs (MOSFET bulk pins unscored), netlist exact-match rate, and truth-table
  equivalence of the rebuilt circuit under DigiSim's own `simulate()` (`ml/sim_bridge/truth_table.cjs`; needs `cd frontend && npm install`; `--no-truth-table` skips it).
- **Frozen sets:** the SHA-256 of the split's images and labels directories as resolved from `data.yaml`, its netlists directory (`--gt-netlists` when given), its `ignore/` regions (when present) and class names must equal the entry in `ml/frozen_sets.json`, otherwise the run exits 3 and writes nothing.
  Register a new set once with `--freeze --frozen-name NAME --freeze-note "..."`; tooling never overwrites an entry. `--freeze` exists because the hash check needs a
  recorded hash to compare against, and every later dataset task (T4 onwards) registers its frozen entry this way. A split with no registered set runs unchecked and the report says "(not frozen - unverified)".
  Registered: `gate12_test`, `real_t4_test` (T4 real test: CGHD drafter 20 + 3 Roboflow images, `ml/data_real/yolo`), `synth_v2_seed1_n8000_test`
  (`generate_v2.py --count 8000 --seed 1` test split).
- **Baselines:** `ml/baselines/gate12.json` is the old 12-class model on the gate-era test split (`gate12_test`); compare a new run with `--baseline ml/baselines/gate12.json`.

## Dataset
- **Source:** Synthetic screenshots from DigiSim (primary) + hand-drawn images (supplement)
- **Generation:** `backend/data_gen/generate_v2.py` (tier A, transistor + gate domains, pins/orientation/netlists,
  topology-hash splits, held-out test styles; see `docs/synth_v2/README.md`); legacy gate-era `backend/data_gen/screenshot_pipeline.py`
- **Augmentation:** `backend/data_gen/augmentation.py`
- **Minimum size:** Phase 1 → 500 images. Phase 2+ → 2000 images
- **Format:** YOLO `.txt` per image - `<class_id> <x_center> <y_center> <width> <height>` (normalized)
- **Class balance:** no class under 10% - check before every training run

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

## Training Harness
`ml/train.py` runs on CPU, one GPU or DDP with the same command (`--device cpu | auto | 0 | 0,1,2,3`); `--workers` defaults to the usable CPU count (max 8) and `--batch` is the total across GPUs (default: 16 per device).
Presets: `smoke` (2 epochs, yolov8n, imgsz 320), `stage-a` (synthetic pretrain, yolov8s, imgsz 960, 100 epochs), `stage-b` (mixed fine-tune from the stage-A `best.pt` via `--model`, real images repeated `--real-oversample` times through `--real-train DIR`, lr0 0.002).
`--time HOURS` (both trainers) replaces the epoch count with a wall-clock budget; ultralytics fits the epochs and LR schedule to it.
Always pretrained weights; `--resume RUN_DIR` continues an interrupted run (it keeps the run's base model, total batch and rebuilt mixed/oversampled dataset, and `metrics.json` records `resumed_from`); `--dry-run` prints the resolved plan (device layout, batch per process, dataset counts, class-vocabulary check against `ml/classes.yaml`) without importing torch.
Each run folder (`ml/experiments/run_*`, gitignored) holds `config.yaml`, `notes.md`, `best.pt`, `best.onnx` and `metrics.json` (per-class P/R/F1/AP/accuracy, the F1/accuracy gate verdict, environment, dataset counts and the effective `data_effective` yaml).
`ml/kaggle/train_kaggle.py` is the self-contained Kaggle twin (installs ultralytics, finds `data.yaml` under `/kaggle/input`, writes the same artifacts to `/kaggle/working/digisim_run`); `ml/tests/test_train_harness.py` keeps its preset table equal to `train.py`.
`ml/kaggle/build_dataset.py --synth DIR --out OUT` assembles the stage-A/B dataset folder (synthetic + real tier A labels, real images downsized, `uncertain_*` regions painted out of real train/valid, `stage_a.yaml`, `stage_b.yaml`, the trainer and `t7_session.py`); upload it as one private Kaggle dataset and run `t7_session.py` (stage A then stage B, each time-budgeted) as the kernel.
`ml/make_smoke_dataset.py` writes a throwaway procedural dataset for harness checks (not training data). Harness tests: `cd ml && uv run pytest` (add `DIGISIM_ML_SMOKE=1` for the 2-epoch CPU run).

## T7 Results (2026-11-18): phase 2 gate NOT met

Tier A detector trained transistor-first: stage A on synthetic data only, stage B mixed with the T4 real data.
**The synthetic gate is missed on two classes (VDD, XOR), and every real-data gate is missed.** Phase 2 is not reached;
`ml/experiments/current_phase.txt` is unchanged. All numbers come from the T6 harness (`evaluate.py`, conf 0.35, IoU 0.5, Wilson 95% CIs)
on the frozen sets `synth_v2_seed1_n8000_test` and `real_t4_test` (hash-verified, never used for tuning or model selection).

**Synthetic held-out-style test** (`synthetic_heldout_style` domain: 391 of the 812 test images, styles never seen in training).
The cells show F1 / accuracy; the gate is F1 >= 0.95 and accuracy >= 0.95.

| run | NMOS | PMOS | VDD | GND | IN | OUT | JUNC | AND | OR | NOT | NAND | NOR | XOR | XNOR | failing |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GPU stage A (synthetic only) | .976/.996 | .979/.969 | **.770/.653** | .998/.998 | .998/.998 | .997/1.0 | .976/.999 | .983/.967 | .982/1.0 | .987/.974 | .967/1.0 | .990/1.0 | **.941/.923** | .964/.985 | VDD, XOR |
| GPU stage B (mixed) | .972/.996 | .975/.966 | **.734/.669** | .992/1.0 | 1.0/1.0 | 1.0/1.0 | .971/.999 | .984/.984 | .991/1.0 | 1.0/1.0 | .989/1.0 | .981/1.0 | .961/**.942** | .964/.971 | VDD, XOR |
| CPU nano stage A | .878/.954 | .871/.854 | .395/.257 | .941/.930 | .913/.868 | .718/.604 | .937/.994 | .816/.836 | .769/.818 | .920/.885 | .748/.909 | .817/.922 | .684/.769 | .818/.794 | 13 of 14 |

On the seen-style half of the test split, both GPU models reach F1 >= 0.98 and accuracy >= 0.98 for every class.

**Real held-out test** (`real_t4_test`: 99 images, CGHD drafter 20 plus 3 Roboflow images). The cells show F1 [95% CI]; the gate is F1 >= 0.85 for classes with >= 30 test instances, and JUNCTION recall >= 0.90.
The table covers tier A only; the harness `overall` row also counts the 1614 tier B objects (resistors, capacitors, inductors) as misses.

| class (test n) | GPU stage A (synthetic only) | GPU stage B (mixed) | CPU nano stage A |
|---|---|---|---|
| NMOS (116) | 0.000 | 0.601 [0.53, 0.67] | 0.009 |
| PMOS (78) | 0.000 | 0.564 [0.47, 0.65] | 0.009 |
| VDD (140) | 0.000 | 0.215 [0.17, 0.28] | 0.012 |
| GND (551) | 0.119 | 0.630 [0.60, 0.66] | 0.114 |
| INPUT_PORT (52) | 0.000 | 0.147 [0.08, 0.25] | 0.000 |
| JUNCTION (5124) | 0.187 | 0.758 [0.75, 0.77] | 0.347 |
| AND (101) | 0.188 | 0.507 [0.43, 0.59] | 0.113 |
| OR (35) | 0.301 | 0.436 [0.31, 0.57] | 0.186 |
| **JUNCTION recall** | 0.154 [0.14, 0.16] | **0.729 [0.72, 0.74]** | 0.260 [0.25, 0.27] |
| tier A micro P / R / F1 | 0.190 / 0.143 / 0.163 | 0.786 / 0.668 / 0.722 | 0.354 / 0.225 / 0.275 |

Too few real test instances to judge (reported, not gated; the synthetic score is the only evidence for these classes):
OUTPUT_PORT 28, NOT 10, NAND 1, NOR 1, XOR 1, XNOR 0.
The ignore regions masked 92 unmatched stage-B predictions (690 `uncertain_*` regions); `unmapped` regions stayed scored.

**Synthetic-only vs mixed ablation.** On real images, stage A to stage B raises tier A F1 from 0.16 to 0.72 and JUNCTION recall from 0.15 to 0.73.
On the synthetic held-out styles it costs almost nothing (micro F1 0.973 vs 0.968). Synthetic data alone does not transfer to hand-drawn photos.
Each real class gains 0.3 to 0.6 F1, but none comes near 0.85.

**Run configuration.**

| run | where | model | data | imgsz | budget | result |
|---|---|---|---|---|---|---|
| GPU stage A | Kaggle 2x T4 DDP, [digisim-t7-run-a](https://www.kaggle.com/code/manijos/digisim-t7-run-a) (private) | yolov8s from COCO | 6354 synthetic train / 834 valid | 960 | `--time 2.8` | 97 epochs, 2.9 h, batch 32, SGD lr0 0.01 |
| GPU stage B | same session | stage A `best.pt` | 2500 synthetic + 231 real x4 = 3424 train; valid 834 synthetic + 100 real | 960 | `--time 1.8` | early-stopped at epoch 33 (patience 15), best epoch 18, 0.6 h |
| CPU nano stage A | local CPU, 4 threads | yolov8n warm-started from the old 12-class gate weights | 6354 synthetic | 640 | `--time 2.5` | 5 epochs, 2.1 h (CPU fallback only, not a candidate) |

Data: `generate_v2.py --count 8000 --seed 1`, plus T4 real data (CGHD drafters 19 and 25 for train, 16 for valid, 20 for test, and Roboflow).
Both were assembled by `ml/kaggle/build_dataset.py`: tier A labels only, real images capped at 1920 px, `uncertain_*` regions painted out of real train/valid.
The kernel ran `ml/kaggle/t7_session.py` (ultralytics 8.4.215, torch 2.11 cu130). Local evaluation used ultralytics 8.4.86 and torch 2.12.1 on CPU.

**Artifacts** (outside git, under `/home/mani/linux-fleet-home/data/digisim-t7-train/`; weights are never committed). sha256 values:

| file | sha256 |
|---|---|
| `kaggle_out/run_a/stage_a/best.pt` | `6cee6e0c3871a51f1163138838eb4b42cdcb574694256e4c5bcd803688a909d2` |
| `kaggle_out/run_a/stage_b/best.pt` | `79b3690b78b57112e694fab09bcfdaf817c5e6edb392d518f97ee72da10154b9` |
| `kaggle_out/run_a/stage_b/best.onnx` | `d8a48245ad3d71c66e149e3e9bf5529267ece82e0a4dda376d902630012ea43d` |
| `ml/experiments/t7_cpu_nano_stage_a/best.pt` | `402b29dd0fb6dff31450c66b83fd039cfb607046f89c2e424039514a6e5271c5` |
| trainer `metrics.json` stage A / B / nano | `635f36bd...f414` / `9a1c8857...828a` / `6698b8f1...d508` |
| `eval/gpu_stage_b_real.json` / `eval/gpu_stage_b_synth.json` | `7a2ba5c18cb3a243...3e4d` / `8a3c83bca38dff69...0657` |
| `eval/gpu_stage_a_real.json` / `eval/gpu_stage_a_synth.json` | `549a0427e3588ed4...aced` / `adbe1447eaef13ea...4036` |
| `eval/cpu_nano_a_real.json` / `eval/cpu_nano_a_synth.json` | `4108fe933e5c94be...2d2f` / `1332af23391fe718...9cf1` |

**Why the gates are missed, and what data would fix it.** The architecture is not the bottleneck: the same model reaches about 0.99 on seen synthetic styles.
- **Real data volume and drafter diversity.** Training saw 231 real images from 2 drafters, and the test set is a third drafter. Recall is the failure mode: precision is 0.79 to 0.92 for NMOS, PMOS, GND and JUNCTION, but recall is 0.42 to 0.73.
  Fix: label tier A on more CGHD drafters. The T4 pilot used only 4 (`CGHD_PILOT_SPLITS` in `ml/real_data/config.py`). Target at least 1000 real training images from at least 10 drafters, keeping the drafter split; adding drafters to the test split creates a new frozen set.
  VDD (F1 0.22) and INPUT_PORT (0.15) are the worst, although train has 184 VDD and 207 INPUT_PORT instances. My best read is drafter style: each drafter draws supplies and terminals their own way, so 2 training drafters do not cover drafter 20.
  In addition, 907 `uncertain_terminal` regions were painted out of the real train images. Resolving those labels (`ml/real_data/labels/`) turns them into positives instead of erased marks.
- **Model selection on the wrong signal.** Stage B early-stopped, and picked `best.pt`, on a validation set that is 90% synthetic (834 of 934 images).
  Synthetic fitness was saturated, so selection was close to noise for real-image quality (best epoch 18; stopped at epoch 33, about 1.2 h before the 1.8 h budget ran out).
  Fix (data/config, not architecture): validate stage B on real images only (drafter 16), or weight real images in the fitness.
  Disable early stopping for the short fine-tune. This needs no new data and is the cheapest next run. It changes selection only, so the real test set stays untouched.
- **Small junctions.** CGHD junctions are about 1% of the image width (about 10 px at 960). Small-object recall is 0.65. Fix: train and evaluate real images at 1280, or tile them.
  This sits ahead of more data for JUNCTION recall.
- **Synthetic VDD and XOR on held-out styles.** The held-out styles include a `circle` VDD symbol and `sketch` strokes that training never shows, by design. The two misses mean the model learned the specific VDD glyphs, not the concept.
  Fix: more VDD symbol variants and line styles in the generator's training styles (keep the held-out ones held out). For XOR, more sketch-like double-curve gates.

**Follow-ups (not done here).**
- `optimizer=auto` in ultralytics ignores `lr0`: stage A ran SGD at 0.01, and stage B AdamW at an auto-computed learning rate. Pin `optimizer` in the presets.
- The `generate_v2` manifest hash for seed 1 / 8000 differs from the one in `docs/synth_v2/README.md`. Re-check generator determinism across environments.
- T10 needs a weights distribution path. The stage B weights (`79b3690b...`) are the best tier A model so far, but they do not pass the gate.

### T7 retrain cycle (2026-11-18): gates still NOT met

One retrain cycle aimed at the causes above: `DIGISIM_MODE=retrain` in `ml/kaggle/t7_session.py`
([digisim-t7-retrain](https://www.kaggle.com/code/manijos/digisim-t7-retrain), private, Kaggle 2x T4).
It starts from the Run A stage A `best.pt` and changes four things at once:
- **Selection on real images only.** Validation is the 100 drafter-16 images, and early stopping is off (patience 1000).
- **More real data.** The real training images are oversampled x8.
- **Stronger augmentation** (`--augment strong`).
- **Targeted synthetic boost.** Training uses 3370 synthetic images: all 1870 with a gate, plus the 1500 gate-free images richest in VDD, GND and INPUT_PORT.

The boosted class targets (VDD, GND, INPUT_PORT, gates) came from Run A's test-set misses, as directed by main. Checkpoint selection used only the real validation set (drafter 16). The retrain numbers below are therefore slightly optimistic for the boosted classes.

Training ran at imgsz 1280 for 1.45 h, 29 epochs. The best real-validation epoch was 26.

An accidental second full Run A session (the kernel mounted the previous dataset version) gives a **replicate** of stage B with identical settings. It measures run-to-run noise.

| real test (`real_t4_test`), F1 | Run A stage B | replicate stage B | retrain |
|---|---|---|---|
| NMOS (116) | 0.601 | 0.230 | 0.244 [0.19, 0.31] |
| PMOS (78) | 0.564 | 0.400 | 0.553 [0.47, 0.64] |
| VDD (140) | 0.215 | 0.235 | 0.346 [0.28, 0.42] |
| GND (551) | 0.630 | 0.661 | 0.680 [0.65, 0.71] |
| INPUT_PORT (52) | 0.147 | 0.100 | 0.149 [0.08, 0.25] |
| JUNCTION (5124) | 0.758 | 0.747 | 0.760 [0.75, 0.77] |
| AND (101) | 0.507 | 0.443 | 0.407 [0.34, 0.48] |
| OR (35) | 0.436 | 0.393 | 0.853 [0.75, 0.92] |
| **JUNCTION recall** | 0.729 | 0.731 | 0.720 [0.71, 0.73] |
| tier A micro F1 | 0.722 | 0.711 | 0.724 |

On the synthetic held-out styles, the retrain still fails **VDD (0.730 / 0.724)**. It also newly fails OR (0.945 / 0.945).
XOR passes (0.953 / 0.981). The replicate passes XOR too, so the Run A XOR miss was noise.
On the seen styles, every class is >= 0.99.

**Reading.** The retrain does not move the pooled numbers: tier A F1 is 0.724 against 0.722 / 0.711, and JUNCTION recall is 0.720 against 0.729.
- **Resolution was not the junction bottleneck.** Training and evaluating at 1280 did not raise JUNCTION recall, which weakens the small-object explanation.
- **Real-validation fitness plateaued by epoch 5** (0.47 to 0.48 for the rest of the run). More epochs or a longer budget would not help.
- **Per-class changes, judged against the replicate spread:**
  - OR (0.44 to 0.85) and VDD (0.22 to 0.35) are the only gains clearly outside it.
  - OR reaches the 0.85 line only nominally: n=35, CI [0.75, 0.92].
  - NMOS (0.60, 0.23, 0.24 across the three runs) shows that NMOS/PMOS polarity on drafter 20 is close to a coin flip between runs.

**Conclusion:** selection, augmentation and resampling are exhausted on the current real data, and the remaining gap is real-data coverage.

Artifacts (outside git): `kaggle_out/retrain/stage_b_retrain/best.pt` sha256 `c0f03b40137e4b2421bb4239aaa34ecdfca5d1f81a8f38f2cef1245fe1dea826`;
`best.onnx` `786720e1...bb03`; `metrics.json` `1e9116a8...65fc1`; `eval/retrain_b_real.json` `c125fba68f3de625...f25d`; `eval/retrain_b_synth.json` `f1b93340f9203f9d...11ad`.
Replicate stage B weights: `kaggle_out/run_a_replicate/stage_b/best.pt` (`5fbfa077...`).

**Extra real data that would help most** (in priority order):
1. **More CGHD drafters with tier A labels.** Aim for at least 10 training drafters, about 1000 images; we have 2 drafters and 231 images today.
   The run-to-run spread and the plateau both point to drafter coverage, not model capacity.
   Grow the validation split to 2 or 3 drafters too, so checkpoint selection is less noisy than one drafter's 100 images.
2. **Per class, the most needed, with targets of roughly 300+ training instances from 5+ drafters each:**
   - VDD and INPUT_PORT: F1 0.35 and 0.15, despite 184 and 207 training instances from only 2 drafters.
   - NMOS/PMOS polarity: the 0.23 to 0.60 swings.
   - OUTPUT_PORT: 28 test instances.
3. **Gates, which CGHD barely has** (test NOT 10, NAND 1, NOR 1, XOR 1, XNOR 0).
   Real gate photos need a source beyond CGHD (for example our own drafters), with at least 30 test instances per gate so the gate can be judged at all.
4. **Resolve the 907 `uncertain_terminal` regions** in the existing real train set (no new drafters needed).
5. **Synthetic:** more VDD symbol variants and line styles in the training styles (keep `circle` held out).
   This is the only fix for the synthetic VDD miss, which none of the three runs passes.

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
| Training | Kaggle GPUs (`ml/kaggle/train_kaggle.py`), local CPU for smoke runs (`ml/train.py`) |
| Inference | Local / Azure |

## What We Are NOT Doing
- Training from random weights
- Using a neural net for wire extraction
- One end-to-end model for image → circuit
- Using only hand-drawn images as the dataset