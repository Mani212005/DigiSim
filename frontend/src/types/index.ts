/**
 * @file index.ts
 * @description Shared TypeScript types for the DigiSim frontend. All domain,
 * component-prop, and auth types live here (never inline in components), and the
 * backend API contracts are re-exported from ./api so callers have one import site.
 */

import type { ChangeEvent } from 'react';
import type { Edge, Node, NodeProps, Viewport } from 'reactflow';
import type {
  AuthUser,
  CircuitComponent,
  CircuitExportJSON,
  CircuitNodeType,
  EnrollResponse,
  InventoryItem,
  LibraryComponent,
  LibraryComponentDetail,
  LibrarySearchResult,
  ProjectFolder,
} from './api';

export * from './api';

// ---------------------------------------------------------------------------
// Circuit domain
// ---------------------------------------------------------------------------

/** Data payload attached to every ReactFlow node in DigiSim. */
export interface NodeData {
  label: string;
  /** Logic level: 0 (LOW) or 1 (HIGH). Kept as `number` so the simulation and
   *  its tests can build values from plain `number[]` without literal-type friction. */
  value: number;
}

/** A ReactFlow node carrying DigiSim node data. */
export type DigiNode = Node<NodeData>;

/** A ReactFlow edge (wire) in a DigiSim circuit. */
export type DigiEdge = Edge;

/** Schematic glyph keys understood by GateShell's SYMBOLS map. */
export type GlyphType =
  | 'and'
  | 'or'
  | 'not'
  | 'nand'
  | 'nor'
  | 'xor'
  | 'xnor';

/** One entry in the sidebar gate palette. */
export interface PaletteEntry {
  type: string;
  label: string;
  glyph: GlyphType;
  name: string;
}

/** Merge new fields into a node's data, keyed by node id. */
export type UpdateNodeData = (id: string, data: Partial<NodeData>) => void;

// ---------------------------------------------------------------------------
// Component props (CLAUDE.md: no inline component interfaces)
// ---------------------------------------------------------------------------

/** Props for the shared gate visual shell. */
export interface GateShellProps {
  type: GlyphType;
  data: NodeData;
  /** Number of input handles to render (1 for NOT, 2 for the rest). */
  inputs?: number;
}

/** Props for the standalone palette glyph. */
export interface GateGlyphProps {
  type: GlyphType;
}

/** Props every gate node component receives from ReactFlow (only `data` is used). */
export interface GateNodeProps {
  data: NodeData;
}

/** Props for the clickable input (toggle-switch) node. */
export interface InputNodeProps {
  id: string;
  data: NodeData;
  updateNodeData: UpdateNodeData;
}

/** Props for the output (LED) node. */
export type OutputNodeProps = Pick<NodeProps<NodeData>, 'data'>;

/** Props for the sidebar sample-image gallery. */
export interface SampleImagesProps {
  images: string[];
  onImageSelect: (url: string) => void;
}

/** Props for the floating multi-selection toolbar. */
export interface SelectionToolbarProps {
  selectedNodes: DigiNode[];
  viewport: Viewport;
  onDelete: () => void;
  onDuplicate: () => void;
}

/** Props for the full-screen camera capture modal. */
export interface CameraCaptureProps {
  onCapture: (blob: Blob) => void;
  onClose: () => void;
  onFallback: () => void;
}

/** One reviewable detection row (a component plus a keep/drop flag). */
export type DetectionRow = CircuitComponent & { keep: boolean };

/** Props for the low-confidence detection review dialog. */
export interface DetectionReviewProps {
  payload: CircuitExportJSON;
  onConfirm: (payload: CircuitExportJSON) => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Value exposed by the auth context / useAuth hook. */
export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** True when browsing as an anonymous guest (cookie-backed guest session). */
  isGuest: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  continueAsGuest: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Circuit analysis (netlist + truth tables)
// ---------------------------------------------------------------------------

/** One independent circuit = a connected component of the node graph. */
export interface Circuit {
  id: string;
  /** Human label, e.g. "Circuit 1". */
  name: string;
  nodeIds: string[];
  inputIds: string[];
  outputIds: string[];
}

/** A single column (input or output) in a truth table. */
export interface TruthTableColumn {
  /** Source/output node id. */
  id: string;
  label: string;
}

/** One row: input value assignment → resulting output values. */
export interface TruthTableRow {
  inputs: number[];
  outputs: number[];
}

/** A fully enumerated truth table for one circuit. */
export interface TruthTable {
  inputs: TruthTableColumn[];
  outputs: TruthTableColumn[];
  rows: TruthTableRow[];
  /** True when the input count exceeded the enumeration cap (rows omitted). */
  truncated: boolean;
}

/** One line of a netlist: a gate or output and the nets it connects. */
export interface NetlistComponent {
  /** Reference designator, e.g. "U1" or "OUT1". */
  ref: string;
  /** Uppercased component type, e.g. "ANDGATE". */
  type: string;
  /** Net names feeding this component's inputs. */
  inputs: string[];
  /** Net name this component drives, or null for sinks (outputs). */
  output: string | null;
}

/** The netlist for a single circuit, both structured and rendered. */
export interface NetlistCircuit {
  circuitId: string;
  name: string;
  /** Input net names (the circuit's primary inputs). */
  inputs: string[];
  components: NetlistComponent[];
  /** Ready-to-copy multi-line text rendering. */
  text: string;
}

/** Clean, portable component entry for the JSON view. */
export interface CircuitGraphComponent {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
}

/** Clean, portable connection entry for the JSON view. */
export interface CircuitGraphConnection {
  from: string;
  to: string;
  fromPort: string | null;
  toPort: string | null;
}

/** Clean circuit graph (mirrors the backend components/connections shape). */
export interface CircuitGraphJSON {
  components: CircuitGraphComponent[];
  connections: CircuitGraphConnection[];
}

/** Both JSON renderings of one circuit for the terminal's Clean/Raw toggle. */
export interface CircuitGraphExport {
  clean: CircuitGraphJSON;
  raw: { nodes: DigiNode[]; edges: DigiEdge[] };
}

// ---------------------------------------------------------------------------
// Netlist export / import (canonical JSON netlist format)
// ---------------------------------------------------------------------------

/** One gate entry in the canonical JSON netlist file. */
export interface NetlistExportComponent {
  /** Reference designator, e.g. "U1". */
  id: string;
  /** Uppercased gate type token, e.g. "AND_GATE". */
  type: string;
  /** Net names feeding the gate's inputs (handle order 'a' then 'b'). */
  inputs: string[];
  /** Net name the gate drives. */
  output: string;
  /** Optional canvas position — honored on import, omitted on export. */
  x?: number;
  y?: number;
}

/** Canonical JSON netlist: pure connectivity, no visual state. */
export interface NetlistExportJSON {
  circuit_name: string;
  /** Gates only — input/output canvas nodes are implied by `io`. */
  components: NetlistExportComponent[];
  /** Every net name used anywhere in the netlist. */
  nets: string[];
  /** Nets driven by input nodes / consumed by output nodes. */
  io: { inputs: string[]; outputs: string[] };
}

/** Id-agnostic node blueprint produced by parseNetlist (App assigns real ids). */
export interface NetlistImportNode {
  /** Local key unique within the parse result, referenced by import edges. */
  key: string;
  type: CircuitNodeType;
  label: string;
  x: number;
  y: number;
}

/** Id-agnostic edge blueprint produced by parseNetlist. */
export interface NetlistImportEdge {
  sourceKey: string;
  targetKey: string;
  targetHandle: 'a' | 'b' | null;
}

/** Successfully parsed netlist ready to be placed on the canvas. */
export interface NetlistImportPayload {
  circuitName: string;
  nodes: NetlistImportNode[];
  edges: NetlistImportEdge[];
}

/** Result of validating + reconstructing a netlist JSON document. */
export type NetlistParseResult =
  | ({ ok: true } & NetlistImportPayload)
  | { ok: false; errors: string[] };

/** Props for the netlist import dialog (file picker + paste textarea). */
export interface NetlistImportDialogProps {
  onImport: (payload: NetlistImportPayload) => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Terminal + netlist panels
// ---------------------------------------------------------------------------

/** What a terminal tab renders. */
export type TerminalTabKind = 'truthTable' | 'json' | 'config';

/** Clean vs raw JSON rendering in a JSON tab. */
export type JsonViewMode = 'clean' | 'raw';

/** One tab in the bottom terminal panel. */
export interface TerminalTab {
  id: string;
  title: string;
  kind: TerminalTabKind;
  /** Circuit this tab targets; null for an unconfigured config tab. */
  circuitId: string | null;
  /** Auto tabs (2 per circuit) are not closable; user tabs are. */
  closable: boolean;
}

/** Props for the bottom terminal panel. */
export interface TerminalPanelProps {
  nodes: DigiNode[];
  edges: DigiEdge[];
  open: boolean;
  onClose: () => void;
}

/** Props for the right-hand netlist sidebar. */
export interface NetlistPanelProps {
  nodes: DigiNode[];
  edges: DigiEdge[];
  open: boolean;
  onToggle: () => void;
  /** Download the whole canvas as a canonical JSON netlist file. */
  onExport: () => void;
  /** Open the netlist import dialog. */
  onImportOpen: () => void;
}

// ---------------------------------------------------------------------------
// Project folders (persistent workspaces)
// ---------------------------------------------------------------------------

/** Circuit state persisted per folder — the raw canvas nodes/edges. */
export interface ProjectState {
  nodes: DigiNode[];
  edges: DigiEdge[];
}

/** GET /projects/<id> response: folder metadata plus its saved circuit. */
export interface ProjectWithState extends ProjectFolder {
  state: ProjectState;
}

/** Fields accepted by PUT /projects/<id> (rename and/or autosave). */
export interface ProjectPatch {
  name?: string;
  description?: string;
  state?: ProjectState;
}

/** The folder currently open in the editor. */
export interface ActiveProject {
  id: number;
  name: string;
}

/** Autosave lifecycle shown in the navbar project chip. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Typed client for the /projects endpoints (returned by useProjects). */
export interface ProjectsApi {
  list: () => Promise<ProjectFolder[]>;
  create: (name: string, description: string) => Promise<ProjectFolder>;
  get: (id: number) => Promise<ProjectWithState>;
  /** keepalive lets the final flush survive page unload. */
  update: (id: number, patch: ProjectPatch, keepalive?: boolean) => Promise<ProjectFolder>;
  remove: (id: number) => Promise<void>;
}

/** Props for the full-screen projects (folder list / create) modal. */
export interface ProjectsModalProps {
  /** Folder currently open in the editor, to highlight its card. */
  activeProjectId: number | null;
  onOpenProject: (folder: ProjectFolder) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component library + project inventory (open-set recognition, R1)
// ---------------------------------------------------------------------------

/** Fields accepted when creating/updating an inventory row. */
export interface InventoryDraft {
  designator?: string;
  name: string;
  qty?: number;
  value?: string;
  library_component_id?: number | null;
}

/** Typed client for the /library and /projects/<id>/inventory endpoints. */
export interface LibraryApi {
  search: (query: string) => Promise<LibrarySearchResult[]>;
  getComponent: (id: number) => Promise<LibraryComponentDetail>;
  createComponent: (canonicalName: string) => Promise<LibraryComponent>;
  enrollImage: (
    componentId: number,
    file: File,
    consentShared: boolean
  ) => Promise<EnrollResponse>;
  /** URL for an enrolled image (cookie-authenticated <img> source). */
  imageUrl: (imageId: number) => string;
  listInventory: (folderId: number) => Promise<InventoryItem[]>;
  addInventory: (folderId: number, items: InventoryDraft[]) => Promise<InventoryItem[]>;
  updateInventory: (
    folderId: number,
    itemId: number,
    patch: Partial<InventoryDraft>
  ) => Promise<InventoryItem>;
  deleteInventory: (folderId: number, itemId: number) => Promise<void>;
}

/** Props for the project inventory modal. */
export interface InventoryModalProps {
  folderId: number;
  projectName: string;
  onClose: () => void;
}

/** Login form mode. */
export type LoginMode = 'login' | 'signup';

/** Props for the login page's floating-label input field. */
export interface GlassFieldProps {
  id: string;
  type: string;
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  autoComplete: string;
}
