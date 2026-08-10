/**
 * @file CellRegistry.ts
 * @description OpenAccess Cell Hierarchy manager for DigiSim.
 * Manages Cellviews (schematic, symbol, spice netlist), cell ports, parameters,
 * and hierarchical parameter pass-through resolution.
 */

import type { CellDefinition, CellPort } from '../../types/hierarchy';
import type { DigiEdge, DigiNode } from '../../types/index';

/** Pre-registered built-in standard cellviews. */
const BUILTIN_CELLS: CellDefinition[] = [
  {
    libraryName: 'worklib',
    cellName: 'INVERTER',
    ports: [
      { name: 'in', direction: 'in', side: 'left' },
      { name: 'out', direction: 'out', side: 'right' },
      { name: 'vdd', direction: 'in', side: 'top' },
      { name: 'vss', direction: 'in', side: 'bottom' },
    ],
    parameters: {
      W_p: 2.4,
      W_n: 1.2,
      L: 0.18,
      techNode: '180nm',
    },
    views: {
      schematic: {
        viewType: 'schematic',
        nodes: [
          {
            id: 'p1',
            type: 'pmos',
            position: { x: 120, y: 40 },
            data: { label: 'MP1', value: 0, width: 2.4, length: 0.18, techNode: '180nm' },
          },
          {
            id: 'n1',
            type: 'nmos',
            position: { x: 120, y: 180 },
            data: { label: 'MN1', value: 0, width: 1.2, length: 0.18, techNode: '180nm' },
          },
        ],
        edges: [
          // Gate connection (in -> MP1.g & MN1.g)
          { id: 'e_g', source: 'p1', target: 'n1', sourceHandle: 's:g', targetHandle: 't:g' },
          // Output connection (MP1.d -> MN1.d)
          { id: 'e_d', source: 'p1', target: 'n1', sourceHandle: 's:d', targetHandle: 't:d' },
        ],
      },
      spice: {
        viewType: 'spice',
        spiceNetlist: `.SUBCKT INVERTER IN OUT VDD VSS PARAMS: W_P=2.4U W_N=1.2U L=0.18U
MP1 OUT IN VDD VDD PMOS W='W_P' L='L'
MN1 OUT IN VSS VSS NMOS W='W_N' L='L'
.ENDS INVERTER`,
      },
    },
  },
  {
    libraryName: 'worklib',
    cellName: 'NAND2',
    ports: [
      { name: 'a', direction: 'in', side: 'left' },
      { name: 'b', direction: 'in', side: 'left' },
      { name: 'out', direction: 'out', side: 'right' },
      { name: 'vdd', direction: 'in', side: 'top' },
      { name: 'vss', direction: 'in', side: 'bottom' },
    ],
    parameters: {
      W_p: 2.4,
      W_n: 2.4,
      L: 0.18,
      techNode: '180nm',
    },
    views: {
      schematic: {
        viewType: 'schematic',
        nodes: [
          {
            id: 'mp1',
            type: 'pmos',
            position: { x: 80, y: 40 },
            data: { label: 'MP1', value: 0, width: 2.4, length: 0.18 },
          },
          {
            id: 'mp2',
            type: 'pmos',
            position: { x: 220, y: 40 },
            data: { label: 'MP2', value: 0, width: 2.4, length: 0.18 },
          },
          {
            id: 'mn1',
            type: 'nmos',
            position: { x: 150, y: 160 },
            data: { label: 'MN1', value: 0, width: 2.4, length: 0.18 },
          },
          {
            id: 'mn2',
            type: 'nmos',
            position: { x: 150, y: 280 },
            data: { label: 'MN2', value: 0, width: 2.4, length: 0.18 },
          },
        ],
        edges: [],
      },
      spice: {
        viewType: 'spice',
        spiceNetlist: `.SUBCKT NAND2 A B OUT VDD VSS PARAMS: W_P=2.4U W_N=2.4U L=0.18U
MP1 OUT A VDD VDD PMOS W='W_P' L='L'
MP2 OUT B VDD VDD PMOS W='W_P' L='L'
MN1 OUT A INT VSS NMOS W='W_N' L='L'
MN2 INT B VSS VSS NMOS W='W_N' L='L'
.ENDS NAND2`,
      },
    },
  },
  {
    libraryName: 'worklib',
    cellName: 'NOR2',
    ports: [
      { name: 'a', direction: 'in', side: 'left' },
      { name: 'b', direction: 'in', side: 'left' },
      { name: 'out', direction: 'out', side: 'right' },
      { name: 'vdd', direction: 'in', side: 'top' },
      { name: 'vss', direction: 'in', side: 'bottom' },
    ],
    parameters: {
      W_p: 4.8,
      W_n: 1.2,
      L: 0.18,
      techNode: '180nm',
    },
    views: {
      schematic: {
        viewType: 'schematic',
        nodes: [],
        edges: [],
      },
      spice: {
        viewType: 'spice',
        spiceNetlist: `.SUBCKT NOR2 A B OUT VDD VSS PARAMS: W_P=4.8U W_N=1.2U L=0.18U
MP1 INT A VDD VDD PMOS W='W_P' L='L'
MP2 OUT B INT VDD PMOS W='W_P' L='L'
MN1 OUT A VSS VSS NMOS W='W_N' L='L'
MN2 OUT B VSS VSS NMOS W='W_N' L='L'
.ENDS NOR2`,
      },
    },
  },
];

export class CellRegistryClass {
  private registry: Map<string, CellDefinition> = new Map();

  constructor() {
    BUILTIN_CELLS.forEach((cell) => {
      this.registerCell(cell);
    });
  }

  private getKey(cellName: string, libraryName = 'worklib'): string {
    return `${libraryName}:${cellName.toUpperCase()}`;
  }

  /**
   * Register a new cell definition in OpenAccess hierarchy.
   */
  public registerCell(def: CellDefinition): void {
    const key = this.getKey(def.cellName, def.libraryName);
    this.registry.set(key, def);
  }

  /**
   * Look up a cell definition by name.
   */
  public getCell(cellName: string, libraryName = 'worklib'): CellDefinition | undefined {
    const key = this.getKey(cellName, libraryName);
    return this.registry.get(key) || this.registry.get(`worklib:${cellName.toUpperCase()}`);
  }

  /**
   * List all registered cell definitions.
   */
  public listCells(): CellDefinition[] {
    return Array.from(this.registry.values());
  }

  /**
   * Create a default cell definition structure.
   */
  public createDefaultCell(
    cellName: string,
    ports: CellPort[],
    parameters: Record<string, number | string> = {},
    libraryName = 'worklib'
  ): CellDefinition {
    const def: CellDefinition = {
      libraryName,
      cellName: cellName.toUpperCase(),
      ports,
      parameters,
      views: {
        schematic: {
          viewType: 'schematic',
          nodes: [],
          edges: [],
        },
      },
    };
    this.registerCell(def);
    return def;
  }

  /**
   * Resolve and flatten internal sub-circuit schematic nodes with instance parameter pass-through.
   *
   * @param cellName - Target cell name (e.g., INVERTER)
   * @param paramOverrides - Parameter overrides provided at subcircuit instance (e.g. { W_p: 1.2, W_n: 0.6 })
   * @param instancePrefix - Unique instance prefix for node IDs
   */
  public instantiateSchematic(
    cellName: string,
    paramOverrides: Record<string, number | string> = {},
    instancePrefix = 'x1'
  ): { nodes: DigiNode[]; edges: DigiEdge[] } {
    const cell = this.getCell(cellName);
    if (!cell || !cell.views.schematic || !cell.views.schematic.nodes) {
      return { nodes: [], edges: [] };
    }

    const mergedParams = { ...cell.parameters, ...paramOverrides };
    const rawNodes = cell.views.schematic.nodes;
    const rawEdges = cell.views.schematic.edges || [];

    const nodes: DigiNode[] = rawNodes.map((node) => {
      const newNodeId = `${instancePrefix}_${node.id}`;
      const newWidth =
        node.type === 'pmos'
          ? (mergedParams['W_p'] as number) ?? (mergedParams['W'] as number) ?? node.data.width
          : (mergedParams['W_n'] as number) ?? (mergedParams['W'] as number) ?? node.data.width;

      const newLength = (mergedParams['L'] as number) ?? node.data.length;
      const newTech = (mergedParams['techNode'] as any) ?? node.data.techNode;

      return {
        ...node,
        id: newNodeId,
        data: {
          ...node.data,
          width: typeof newWidth === 'number' ? newWidth : node.data.width,
          length: typeof newLength === 'number' ? newLength : node.data.length,
          techNode: newTech || node.data.techNode,
        },
      };
    });

    const edges: DigiEdge[] = rawEdges.map((edge) => ({
      ...edge,
      id: `${instancePrefix}_${edge.id}`,
      source: `${instancePrefix}_${edge.source}`,
      target: `${instancePrefix}_${edge.target}`,
    }));

    return { nodes, edges };
  }
}

export const CellRegistry = new CellRegistryClass();
