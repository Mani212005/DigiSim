# Definition of Done

Every task is incomplete until ALL relevant checks below pass.
Reviewer agent runs this checklist before approving anything.

---

## Universal Checks (every task)
- [ ] Every new file has a header comment block
- [ ] Every new function has a JSDoc or docstring
- [ ] No `any` types introduced in TypeScript
- [ ] `cd frontend && npm test -- --watchAll=false` → zero failures
- [ ] `uv run ruff check .` → zero warnings
- [ ] `uv run ruff format .` → no diffs
- [ ] No model weights committed to git

---

## Frontend — New Gate Type
- [ ] Gate renders on canvas with correct input/output Handle positions
- [ ] Simulation evaluates correctly for all truth table input combinations
- [ ] Test file `<Name>GateNode.test.tsx` covers all truth table cases
- [ ] Gate appears in `addNode` button list
- [ ] `tsc --noEmit` → zero errors

## Frontend — New UI Feature
- [ ] Loading state shown during async operations
- [ ] Error state shown and user-facing message is readable
- [ ] Success state renders correct output
- [ ] No inline type definitions — all types in `src/types/`
- [ ] `tsc --noEmit` → zero errors

---

## Backend — New Endpoint
- [ ] Returns correct JSON shape matching TypeScript interface in `src/types/api.ts`
- [ ] Handles malformed input without 500 error — returns structured error JSON
- [ ] Tested manually with `curl` or equivalent — output shown in commit notes
- [ ] Type hints on every function
- [ ] `uv run ruff check .` → zero warnings

## Backend — Pipeline Stage Change
- [ ] Stage input/output contract unchanged (or `src/types/api.ts` updated to match)
- [ ] Tested with a real circuit image — output logged
- [ ] No ruff warnings

---

## ML — Phase Completion Criteria

### Phase 1 (AND, OR, NOT)
- [ ] `evaluate.py` reports F1 ≥ 0.95 for AND individually
- [ ] `evaluate.py` reports F1 ≥ 0.95 for OR individually
- [ ] `evaluate.py` reports F1 ≥ 0.95 for NOT individually
- [ ] mAP@0.5 ≥ 0.90 overall
- [ ] Inference on 5 unseen images completes in under 3 seconds on CPU
- [ ] `/detect_circuit` returns valid JSON matching `CircuitExportJSON`
- [ ] Training run logged in `ml/experiments/run_YYYYMMDD_HHMM/`
- [ ] `ml/experiments/current_phase.txt` updated to `2`

### Phase 2 (All 12 classes)
- [ ] F1 ≥ 0.95 for every class individually (all 12)
- [ ] mAP@0.5 ≥ 0.90 overall
- [ ] No class under 10% in confusion matrix
- [ ] Training run logged
- [ ] `current_phase.txt` updated to `3`

### Phase 3 (Wire Extraction + Graph)
- [ ] Wire extraction correctly traces connections on 5 test images
- [ ] Graph builder produces a valid `networkx.DiGraph` with correct node/edge count
- [ ] No isolated nodes in output graph (every component is connected)
- [ ] Training run logged
- [ ] `current_phase.txt` updated to `4`

### Phase 4 (Full Export)
- [ ] DigiSim imports exported JSON and recreates the circuit correctly
- [ ] Tested on at least 3 distinct circuit topologies
- [ ] Round-trip verified: image → JSON → DigiSim → matches original circuit

---

## ML — Every Training Run
- [ ] `ml/experiments/run_YYYYMMDD_HHMM/config.yaml` written
- [ ] `ml/experiments/run_YYYYMMDD_HHMM/metrics.json` written
- [ ] `ml/experiments/run_YYYYMMDD_HHMM/notes.md` explains what changed and why
- [ ] Class balance checked before run — no class under 10%
- [ ] Confusion matrix inspected — worst class identified and noted

---

## Git — Every Feature Branch
- [ ] Branch named `feature/<what-was-built>`
- [ ] Commits use convention: `type(agent): description`
- [ ] No `.env`, weights, or `node_modules` committed
- [ ] Merged to `main` only after all relevant checks above pass
- [ ] Working milestone tagged: `git tag v<x.y>-<description>`