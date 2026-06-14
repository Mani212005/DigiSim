# DigiSim

Circuit simulator: drag-and-drop ReactFlow canvas + image-to-circuit via local YOLO detection pipeline.

## Stack
- Frontend: React + TypeScript, ReactFlow, Jest + RTL — package manager: npm
- Backend: Flask — package manager: uv, linter/formatter: Ruff
- ML: PyTorch, YOLOv8 (transfer learning only), OpenCV, NetworkX

## Commands
```bash
# Frontend
cd frontend && npm install && npm start     # dev server → localhost:3000
cd frontend && npm test -- --watchAll=false

# Backend
cd backend && uv sync
uv run python app.py                        # port 5001
uv run ruff check . && uv run ruff format .

# ML
cd ml && uv run python evaluate.py          # prints F1 + accuracy per class
uv run python backend/data_gen/screenshot_pipeline.py
```

## Environment Variables
backend/.env  →  MODEL_WEIGHTS_PATH, DETECTION_CONFIDENCE_THRESHOLD

frontend/.env →  REACT_APP_API_URL=http://localhost:5001

## Non-Negotiable Code Standards

**Every Python file must start with:**
```python
"""
Module: <filename>.py
Purpose: <what this file does and why it exists>
"""
```

**Every TypeScript file must start with:**
```typescript
/**
 * @file <filename>.tsx
 * @description <what this file does and why it exists>
 */
```

**Every function must be documented:**
```python
def fn(x: int) -> bool:
    """
    One-line summary.

    Args:
        x: What x is.
    Returns:
        What is returned.
    Raises:
        ValueError: When this happens.
    """
```
```typescript
/**
 * One-line summary.
 * @param x - What x is
 * @returns What is returned
 */
```

## Critical Rules

**Architecture**
- `App.tsx` owns ALL node/edge state — nowhere else
- Gate logic lives ONLY in `useLogicSimulation.ts:evaluateGate`
- All TS types/interfaces live in `src/types/` — never inline in components
- Pipeline stages are strictly sequential: Detection → Wire Extraction → Graph → Export
- Model weights are never committed to git

**TypeScript**
- No `any` — ever. Use `unknown` and narrow it, or define a proper type in `src/types/`
- Functional components only

**Python**
- Type hints on every function signature
- `pathlib.Path` not `os.path`
- Never bare `except:` — always catch specific exceptions
- `uv run ruff check .` must pass zero warnings before any task is considered done
- `uv run ruff format .` before finishing any backend or ML task

**ML**
- Transfer learning only — never train from random weights
- No neural networks for wire extraction — classical CV (OpenCV) only
- Never advance training phases without hitting F1 ≥ 0.95 and accuracy ≥ 0.95 per class

## Agent Routing
| Task | Subagent |
|------|----------|
| New features, gate types | `coder` |
| Bug review, logic errors | `reviewer` |
| Test writing and running | `tester` |
| Refactor, cleanup | `optimizer` |
| Model training, evaluation, iteration | `model` |

Parallel independent tasks → spawn subagents simultaneously.

## Compaction — Always Preserve
- Modified files list
- Test results and ruff output
- Current ML phase + latest F1/accuracy per class
- Active task acceptance criteria

## Reference Docs
- `@agent_docs/adding-gates.md`
- `@agent_docs/ml-pipeline.md`
- `@agent_docs/typescript-conventions.md`
- `@agent_docs/simulation-engine.md`