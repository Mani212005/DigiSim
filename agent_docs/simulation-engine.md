# Simulation Engine

## Location
`frontend/src/hooks/useLogicSimulation.ts`

## What It Does
On every `nodes` or `edges` state change in `App.tsx`, runs a full circuit evaluation:
1. Builds an adjacency list from current edges
2. Topological sort (Kahn's algorithm)
3. Propagates 0/1 values gate by gate in sorted order
4. Returns updated nodes with computed output values

## Topological Sort
Uses Kahn's algorithm (BFS-based). Handles cycles by detecting nodes that never reach zero in-degree — these are skipped and their outputs default to `0`.

## evaluateGate
Single dispatch point for all gate logic. Implemented as a lookup map — not a switch statement:
```typescript
const gateHandlers: Record<GateType, GateHandler> = {
  AND:  (inputs) => inputs.every(Boolean),
  OR:   (inputs) => inputs.some(Boolean),
  NOT:  ([a]) => !a,
  NAND: (inputs) => !inputs.every(Boolean),
  NOR:  (inputs) => !inputs.some(Boolean),
  XOR:  ([a, b]) => a !== b,
  XNOR: ([a, b]) => a === b,
};
```

**CRITICAL:** All gate logic lives here and only here. Never add evaluation logic to node components.

## Adding Logic for a New Gate
Add one entry to `gateHandlers`. Nothing else in this file changes.

## Edge Cases
- **No inputs:** defaults to `0`
- **Cycle detected:** all nodes in the cycle output `0`
- **Disconnected node:** retains previous output value
- **Missing handler:** throws `UnknownGateTypeError` — never silently defaults