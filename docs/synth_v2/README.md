# Synthetic circuit dataset v2

Generator: `backend/data_gen/generate_v2.py` (package `backend/data_gen/synth_v2/`). Class vocabulary: tier A of `ml/classes.yaml`.

```bash
cd backend
uv run python data_gen/generate_v2.py --count 8000 --seed 1            # -> ml/dataset/synth_v2 (gitignored)
uv run python data_gen/generate_v2.py --count 8000 --seed 1 --out DIR --workers 4
node ../frontend/scripts/verifySynthNetlists.js DIR                      # switch-level truth-table check
uv run python data_gen/synth_v2/contact_sheet.py --data DIR --out sheet.jpg --samples 50
uv run pytest test_generate_v2.py
```

## What it generates

1. **Netlist-driven topologies** (`logic.py`).
   - **Transistor domain (70%):** static CMOS cells built from series-parallel pull-down/pull-up networks (INV, NAND2/3, NOR2/3, AOI/OAI 21/22/211, random complex gates), AND/OR/BUF, XOR/XNOR, transmission-gate 2:1 mux, and random 2-3 stage chains. Some samples also expose an internal stage output as an extra output.
   - **Gate domain (30%):** random gate DAGs with 2-4 inputs, 2-8 gates and depth up to 4.
   - The reference truth table comes from the abstract boolean function, not from the transistors.
2. **Textbook placement and routing** (`layout.py`, `router.py`).
   - Transistor circuits use the CMOS layout: pull-up network on top, pull-down network below, series stacks drawn vertically and parallel branches side by side. Transmission gates are drawn horizontally.
   - Gate circuits are laid out left to right in layers.
   - Supplies are drawn in one of three styles: a shared rail, one symbol per stage, or one symbol per device.
   - Some drawings get a global rotation or mirror.
   - An orthogonal maze router draws each net as a tree. Different nets only cross at right angles (no dot, recorded as a crossing), and every same-net branch point gets a junction dot. This makes the drawing an exact picture of the netlist.
3. **Rendering** (`render.py`, `symbols.py`).
   - Four modes: cad, textbook, hand-drawn (wobble), and phone photo (perspective, lighting, shadow, blur, noise, JPEG).
   - Symbol variants: 3- vs 4-terminal MOSFETs, bubble vs arrow PMOS, dashed channel, ANSI vs IEC gates, and several VDD, GND and port shapes.
   - Papers, inks and Hershey fonts are varied. Port, supply and device labels and titles are placed only where they do not touch ink.
   - Junction dot diameter is 10-17 px at 1000 px image width, matching the earlier real-data finding.

## Output layout (per sample `NNNNNN`, split in `train|valid|test`)

| File | Content |
|---|---|
| `images/<split>/NNNNNN.jpg` | image |
| `labels/<split>/NNNNNN.txt` | YOLO boxes, ids from `ml/classes.yaml` (symbols and JUNCTION dots) |
| `annotations/<split>/NNNNNN.json` | per symbol: id, class, bbox, variant, **pin points** per terminal, **orientation** (`rotation` clockwise after optional `mirror`), terminal nets; junctions (center, diameter, bbox, net); wire polylines per net; crossings; text boxes; render style |
| `netlists/<split>/NNNNNN.json` | components (devices, ports, supply symbols, with `node_type` and terminal-to-net pins), nets, inputs, outputs, reference truth table, topology hash |
| `manifest.json` | seed, count, per-sample split/domain/recipe/topology hash/held-out flag and SHA-256 of every file (canonical JSON, byte-identical for a given seed and count) |
| `balance_report.json` | per-domain and per-split class counts, the 10%-of-max rule, junction dot size stats |
| `data.yaml` | YOLO dataset config (tier A) |

## Splits and held-out styles

- **Split:** decided by an isomorphism-invariant topology hash of the logical circuit (Weisfeiler-Lehman over devices, nets and port roles). The result is about 80/10/10, and a circuit never appears in two splits.
- **Held-out styles:** half of the test samples use a style that train and valid never see: the `script_complex` font, `grid` paper, the `sketch` double-stroke line style and the `circle` VDD symbol.

## Acceptance run (seed 1, 8000 samples, 4 workers)

- **Reproducibility:** two runs gave byte-identical `manifest.json` (sha256 `36bc64bff0c19ddd1c332a45715a04c21c133e87b365de2006cc3022459a2aad`). About 9 min each under `nice` with 4 workers, 723 MB output.
- **Splits:** train 6354, valid 834, test 812. 391 test samples use held-out styles.
- **Truth tables:** `verifySynthNetlists.js` passes 8000/8000 netlists (5616 transistor, 2384 gate) with DigiSim's `switchLevel.ts` solver. Gate netlists are lowered to static CMOS first.
- **Class balance** (no class under 10% of the domain max):

  | Domain | Images | Counts | Min ratio |
  |---|---|---|---|
  | Transistor | 5616 | NMOS 20642, PMOS 20642, VDD 10117, GND 10043, INPUT_PORT 15019, OUTPUT_PORT 6681, JUNCTION 57391 | 0.116 (OUTPUT_PORT) |
  | Gate | 2384 | AND 1144, OR 1169, NOT 1330, NAND 1119, NOR 1109, XOR 1170, XNOR 1122, INPUT_PORT 6917, OUTPUT_PORT 2982, JUNCTION 2862 | 0.160 (NOR) |

- **Junction dots:** 60253 dots, diameter 10.0-17.0 px per 1000 px width (mean 12.3).
- `contact_sheet.jpg`: overlays of 50 random samples from this run. It shows class boxes, pin points with terminal names, junction boxes (red) and crossings (magenta x).

## Limits and follow-ups

- **Combinational circuits only.** The switch-level solver resolves one combinational state, so circuits with feedback (latches, 6T SRAM, ring oscillators) are not generated. Adding them needs a sequential check.
- **Tier B (analog) classes are not drawn yet.**
- **Committed manifest:** the per-file `ml/data_manifest.json` that merges synthetic and real data belongs to the real-data ingestion task. This generator writes its own `manifest.json` next to the data.
