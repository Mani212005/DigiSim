/**
 * @file hierarchy.ts
 * @description Types for OpenAccess Cell Hierarchy, Cellviews (schematic, symbol, spice),
 * ports, and parameter pass-through in DigiSim sub-circuits.
 */

import type { DigiEdge, DigiNode } from './index';

export type ViewType = 'schematic' | 'symbol' | 'spice';
export type PortDirection = 'in' | 'out' | 'inout';
export type PortSide = 'left' | 'right' | 'top' | 'bottom';

/** Port / Pin definition for a cellview. */
export interface CellPort {
  name: string;
  direction: PortDirection;
  side?: PortSide;
}

/** Parameter definition for a cell. */
export interface CellParameter {
  name: string;
  defaultValue: number | string;
  type: 'number' | 'string';
  description?: string;
}

/** A cellview representation (schematic graph, symbol layout, or SPICE netlist). */
export interface CellView {
  viewType: ViewType;
  /** Internal nodes for schematic view */
  nodes?: DigiNode[];
  /** Internal edges for schematic view */
  edges?: DigiEdge[];
  /** Raw SPICE text netlist for spice view */
  spiceNetlist?: string;
  /** SVG definition or layout for custom symbol view */
  symbolSvg?: string;
}

/** Master OpenAccess Cell Definition. */
export interface CellDefinition {
  libraryName: string;
  cellName: string;
  ports: CellPort[];
  parameters: Record<string, number | string>;
  views: Partial<Record<ViewType, CellView>>;
}

/** Sub-circuit instance node data stored in ReactFlow nodes. */
export interface SubcktNodeData {
  cellName: string;
  libraryName?: string;
  /** Instance parameter overrides (e.g., W_p=1.2u) */
  params: Record<string, number | string>;
}
