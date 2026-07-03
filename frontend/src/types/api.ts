/**
 * @file api.ts
 * @description TypeScript contracts for the DigiSim backend API. These mirror the
 * JSON shapes produced by backend/app.py and backend/pipeline/circuit_exporter.py —
 * keep both sides in sync when either changes.
 */

/** ReactFlow node type strings understood by the canvas. */
export type CircuitNodeType =
  | 'input'
  | 'output'
  | 'andGate'
  | 'orGate'
  | 'notGate'
  | 'nandGate'
  | 'norGate'
  | 'xorGate'
  | 'xnorGate';

/** One detected component placed on the canvas. */
export interface CircuitComponent {
  id: string;
  type: CircuitNodeType;
  label: string;
  /** Top-left corner in source-image pixels. */
  x: number;
  y: number;
  /** Detector confidence in [0, 1]. */
  confidence: number;
}

/** One directed wire between two components. */
export interface CircuitConnection {
  from: string;
  to: string;
  fromPort: 'output';
  /** Target handle id — 'a'/'b' for gates, null for single-handle nodes. */
  toPort: 'a' | 'b' | null;
}

/** Raw YOLO detection returned alongside the assembled circuit. */
export interface GateDetection {
  class: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Success payload of POST /detect_circuit. */
export interface CircuitExportJSON {
  status: 'ok';
  components: CircuitComponent[];
  connections: CircuitConnection[];
  detections: GateDetection[];
}

/** 503 payload of POST /detect_circuit while weights are missing. */
export interface PipelineNotReadyResponse {
  status: 'pipeline_not_ready';
  message: string;
}

/** Error payload returned by backend endpoints. */
export interface ApiErrorResponse {
  error: string;
}
