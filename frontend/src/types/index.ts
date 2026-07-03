/**
 * @file index.ts
 * @description Shared TypeScript interfaces for the DigiSim frontend.
 * All types and interfaces used across components live here — never inline in components.
 */

/** Data payload attached to every ReactFlow node in DigiSim. */
export interface NodeData {
  label: string;
  value: number;
}

/** A single gate detection result returned by the backend /detect_gates endpoint. */
export interface GateDetection {
  class: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Shape of the JSON response from POST /detect_gates. */
export interface DetectGatesResponse {
  detections: GateDetection[];
}

/** A single component entry in the full pipeline export (Stage 4 output). */
export interface CircuitComponent {
  id: string;
  type: string;
  x: number;
  y: number;
}

/** A single wire connection in the full pipeline export. */
export interface CircuitConnection {
  from: string;
  to: string;
  fromPort: string;
  toPort: string;
}

/** Shape of the JSON returned by POST /detect_circuit (Stage 4 — full pipeline). */
export interface CircuitExportJSON {
  components: CircuitComponent[];
  connections: CircuitConnection[];
}
