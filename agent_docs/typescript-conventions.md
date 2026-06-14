# TypeScript Conventions

## Type Definitions
All shared types in `src/types/`. Never define types inline in component files.
src/types/

├── gate.ts       # GateType enum, GateHandler, GateNode interfaces

├── circuit.ts    # CircuitNode, CircuitEdge (wrap ReactFlow types here)

├── api.ts        # DetectionResult, CircuitExportJSON, pipeline response shapes

└── index.ts      # Re-exports everything — import from here, not individual files

## Naming
- Object shapes → `interface` in PascalCase: `GateNode`, `CircuitEdge`
- Unions and primitives → `type` in PascalCase: `GateType`, `DetectionResult`
- Enums → PascalCase members: `GateType.AND`

## No `any` — Ever
```typescript
// Wrong
const result: any = await response.json();

// Right
const result = await response.json() as unknown;
if (isDetectionResult(result)) { /* narrow here */ }
```

Write a type guard for every external data boundary (API responses, file uploads, URL params).

## Component Pattern
```typescript
/**
 * @file AndGateNode.tsx
 * @description ReactFlow custom node for an AND gate — two inputs, one output.
 */

interface AndGateNodeProps {
  data: { label: string; value: boolean };
}

/**
 * Renders an AND gate on the ReactFlow canvas.
 * @param props - Label and current output value
 * @returns ReactFlow node element with input/output Handles
 */
const AndGateNode: React.FC<AndGateNodeProps> = ({ data }) => { ... };

export default AndGateNode;
```

## Async State Pattern
Every async operation must model all three states explicitly:
```typescript
interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}
```
Never render data without checking `loading` and `error` first.

## Import Order
1. React and React hooks
2. Third-party libraries (ReactFlow, etc.)
3. Types from `src/types/`
4. Local components
5. Local hooks
6. Styles