# Adding a New Gate Type

## 4 Required Changes — All Mandatory

### 1. `frontend/src/nodes/<Name>GateNode.tsx`
Copy `AndGateNode.tsx` exactly. Change:
- Component name
- Number of input Handles (NOT gate = 1, all others = 2)
- Gate label string
- File header `@description`

### 2. `App.tsx`
Two locations:
```typescript
// 1. nodeTypes object
const nodeTypes = {
  and: AndGateNode,
  <name>: <Name>GateNode,   // add here
};

// 2. addNode button list — match existing button pattern exactly
```

### 3. `useLogicSimulation.ts:evaluateGate`
Add a case to the gate handler lookup map:
```typescript
const gateHandlers: Record<GateType, GateHandler> = {
  AND: (inputs) => inputs.every(Boolean),
  <NAME>: (inputs) => <evaluation logic>,
};
```

### 4. `backend/pipeline/detector.py`
Add class name to the detection → node type mapping:
```python
CLASS_TO_NODE_TYPE: dict[str, str] = {
    "AND": "and",
    "<NAME>": "<name>",   # add here
}
```

## Truth Tables for Reference
| Gate | 2-input logic |
|------|--------------|
| AND  | A & B |
| OR   | A \| B |
| NAND | !(A & B) |
| NOR  | !(A \| B) |
| XOR  | A ^ B |
| XNOR | !(A ^ B) |
| NOT  | !A (1 input only) |

## Checklist Before Marking Done
- [ ] File header comment in new node file
- [ ] JSDoc on every new function
- [ ] `npm test -- --watchAll=false` → zero failures
- [ ] `uv run ruff check .` → zero warnings