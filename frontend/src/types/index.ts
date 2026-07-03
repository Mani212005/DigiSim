/**
 * @file index.ts
 * @description Shared TypeScript types for the DigiSim frontend. All domain,
 * component-prop, and auth types live here (never inline in components), and the
 * backend API contracts are re-exported from ./api so callers have one import site.
 */

import type { ChangeEvent } from 'react';
import type { Edge, Node, NodeProps, Viewport } from 'reactflow';
import type { AuthUser, CircuitComponent, CircuitExportJSON } from './api';

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
