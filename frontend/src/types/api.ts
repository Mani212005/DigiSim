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

/** Success payload of POST /detect_gates (cloud fallback — boxes only). */
export interface DetectGatesResponse {
  detections?: GateDetection[];
  /** Roboflow-style responses use this key instead of `detections`. */
  predictions?: GateDetection[];
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

/** Authenticated (or guest) user as returned by /auth/* endpoints. */
export interface AuthUser {
  id: number | null;
  email: string | null;
  /** True for anonymous guest sessions issued by POST /auth/guest. */
  guest?: boolean;
}

/** Body of POST /auth/login, /auth/signup, /auth/guest and GET /auth/me. */
export interface AuthResponse {
  user: AuthUser;
}

/** Project folder metadata as returned by the /projects endpoints. */
export interface ProjectFolder {
  id: number;
  name: string;
  description: string;
  /** ISO-8601 UTC timestamps set by the backend. */
  created_at: string;
  updated_at: string;
}

/** Body of GET /projects. */
export interface ProjectListResponse {
  projects: ProjectFolder[];
}

/** Pin role tokens used in library pin maps. */
export type PinRole =
  | 'power'
  | 'ground'
  | 'digital'
  | 'analog'
  | 'pwm'
  | 'data'
  | 'clock'
  | 'io'
  | 'anode'
  | 'cathode'
  | 'passive'
  | 'nc';

/** One physical pin of a library component. */
export interface LibraryPin {
  name: string;
  role: PinRole;
  side: 'left' | 'right' | 'top' | 'bottom';
}

/** Pin layout of a library component; partial=true when the seed omits pins. */
export interface PinMap {
  pins: LibraryPin[];
  partial?: boolean;
}

/** One entry of the shared component library. */
export interface LibraryComponent {
  id: number;
  canonical_name: string;
  aliases: string[];
  category: string;
  package: string;
  pin_map: PinMap;
  sim_model: Record<string, unknown>;
  source: 'seed' | 'community';
  verified: boolean;
  image_count?: number;
}

/** A search hit from GET /library/search. */
export interface LibrarySearchResult extends LibraryComponent {
  score: number;
}

/** Quality report attached to an enrolled reference image. */
export interface ImageQuality {
  width: number;
  height: number;
  blur_score: number;
  brightness: number;
  warnings: string[];
}

/** Metadata of one enrolled reference image. */
export interface ComponentImageMeta {
  id: number;
  domain: 'photo' | 'symbol';
  quality: ImageQuality;
  consent_shared: boolean;
  created_at?: string;
}

/** GET /library/components/<id> response: component plus its images. */
export interface LibraryComponentDetail extends LibraryComponent {
  images: ComponentImageMeta[];
}

/** Body of POST /library/components/<id>/images. */
export interface EnrollResponse {
  image: ComponentImageMeta;
  warnings: string[];
}

/** Pixel-space bounding box of a photo proposal (source-image coordinates). */
export interface DetectBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** One scored library/inventory candidate for a photo proposal. */
export interface DetectCandidate {
  /** Matcher slot id, e.g. 'inv-12-0' or 'lib-4'. */
  target_id: string;
  /** Display label, e.g. 'U1 · ESP32 DevKit V1'. */
  label: string;
  component_id: number | null;
  inventory_item_id: number | null;
  /** Fused identity score in [0, 1]. */
  score: number;
  visual: number;
  ocr: number;
}

/** One detected component region in a photo, with its identity verdict. */
export interface DetectProposal {
  box: DetectBox;
  confidence: number;
  /** Open-vocab class guess ('circuit board', …) or 'region' for contours. */
  hint: string;
  source: 'yoloe' | 'contour';
  /** JPEG data URI of the crop (≤160px) for the review UI. */
  crop: string;
  /** Lowercased OCR fragments read from the crop. */
  ocr: string[];
  assigned: DetectCandidate | null;
  candidates: DetectCandidate[];
  needs_review: boolean;
  /** Review reasons: 'no_confident_match' | 'low_score' | 'small_margin' |
   *  'ocr_only' | 'no_embedding'. */
  reasons: string[];
}

/** Domain-router evidence returned with every /detect_v2 response. */
export interface DetectV2Signals {
  saturated_fraction: number;
  bright_fraction: number;
}

/** /detect_v2 verdict for a drawn schematic — caller should use /detect_circuit. */
export interface DetectV2SchematicResponse {
  domain: 'schematic';
  signals: DetectV2Signals;
}

/** /detect_v2 result for a physical-build photo. */
export interface DetectV2PhotoResponse {
  domain: 'photo';
  /** True when the project inventory constrained the assignment. */
  used_inventory: boolean;
  proposals: DetectProposal[];
  inventory_report: {
    matched: number;
    unknown: number;
    /** Inventory labels never found in the photo, e.g. 'R1 · Resistor ×4'. */
    missing: string[];
  };
  signals: DetectV2Signals;
}

/** Success payload of POST /detect_v2 (discriminated on `domain`). */
export type DetectV2Response = DetectV2SchematicResponse | DetectV2PhotoResponse;

/** One row of a project's parts inventory. */
export interface InventoryItem {
  id: number;
  folder_id: number;
  designator: string;
  name_raw: string;
  qty: number;
  value: string;
  library_component_id: number | null;
}
