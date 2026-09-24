/**
 * @file standardCells.ts
 * @description Transistor-first seeded standard cells for the personal library.
 * NOT/NAND/NOR are hand-wired CMOS (PMOS pull-up + NMOS pull-down with an
 * internal VDD/VSS), so they simulate through the switch-level solver.
 * AND/OR/XOR are hierarchical: they nest the transistor cells (AND = NAND+NOT,
 * OR = NOR+NOT, XOR = 4x NAND), proving cells reuse inside other cells down
 * to transistors. Ids are stable (`std-*`) so nesting references survive
 * reloads; seeding is versioned and idempotent.
 */

import type { CustomComponentDefinition, DigiEdge, DigiNode } from '../../types';

const SEED_VERSION = '1';
const SEED_FLAG_KEY = 'digisim_std_cells_version';
const LIB_KEY = 'customComponents';

const NOT_DEF: CustomComponentDefinition = {
  id: 'std-not',
  name: 'NOT',
  description: 'CMOS inverter built from 1 PMOS + 1 NMOS (inspectable to transistors).',
  category: 'Standard Cells',
  pins: [
    { id: 'in', label: 'A', type: 'INPUT', side: 'LEFT' },
    { id: 'out', label: 'Y', type: 'OUTPUT', side: 'RIGHT' },
  ],
  subcircuit: {
    nodes: [
      { id: 'in', type: 'input', position: { x: 40, y: 140 }, data: { label: 'in', value: 0 } },
      { id: 'vdd', type: 'vsource', position: { x: 220, y: 20 }, data: { label: 'VDD', param: 5 } },
      { id: 'mp1', type: 'pmos', position: { x: 210, y: 90 }, data: { label: 'MP1', width: 2.4, length: 0.18 } },
      { id: 'mn1', type: 'nmos', position: { x: 210, y: 210 }, data: { label: 'MN1', width: 1.2, length: 0.18 } },
      { id: 'gnd', type: 'ground', position: { x: 230, y: 320 }, data: { label: 'VSS' } },
      { id: 'out', type: 'output', position: { x: 420, y: 140 }, data: { label: 'out', value: 0 } },
    ] as DigiNode[],
    edges: [
      { id: 'e_in_p', source: 'in', target: 'mp1', targetHandle: 't:g' },
      { id: 'e_in_n', source: 'in', target: 'mn1', targetHandle: 't:g' },
      { id: 'e_vdd_p', source: 'vdd', sourceHandle: 's:pos', target: 'mp1', targetHandle: 't:s' },
      { id: 'e_p_out', source: 'mp1', sourceHandle: 's:d', target: 'out' },
      { id: 'e_n_out', source: 'mn1', sourceHandle: 's:d', target: 'out' },
      { id: 'e_n_gnd', source: 'mn1', sourceHandle: 's:s', target: 'gnd', targetHandle: 't:gnd' },
    ] as DigiEdge[],
  },
  symbolShape: 'RECTANGLE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const NAND_DEF: CustomComponentDefinition = {
  id: 'std-nand',
  name: 'NAND',
  description: 'CMOS NAND2: 2 PMOS in parallel, 2 NMOS in series.',
  category: 'Standard Cells',
  pins: [
    { id: 'a', label: 'A', type: 'INPUT', side: 'LEFT' },
    { id: 'b', label: 'B', type: 'INPUT', side: 'LEFT' },
    { id: 'out', label: 'Y', type: 'OUTPUT', side: 'RIGHT' },
  ],
  subcircuit: {
    nodes: [
      { id: 'a', type: 'input', position: { x: 40, y: 80 }, data: { label: 'a', value: 0 } },
      { id: 'b', type: 'input', position: { x: 40, y: 220 }, data: { label: 'b', value: 0 } },
      { id: 'vdd', type: 'vsource', position: { x: 240, y: 10 }, data: { label: 'VDD', param: 5 } },
      { id: 'mp1', type: 'pmos', position: { x: 180, y: 70 }, data: { label: 'MP1', width: 2.4, length: 0.18 } },
      { id: 'mp2', type: 'pmos', position: { x: 320, y: 70 }, data: { label: 'MP2', width: 2.4, length: 0.18 } },
      { id: 'mn1', type: 'nmos', position: { x: 250, y: 170 }, data: { label: 'MN1', width: 1.2, length: 0.18 } },
      { id: 'mn2', type: 'nmos', position: { x: 250, y: 270 }, data: { label: 'MN2', width: 1.2, length: 0.18 } },
      { id: 'gnd', type: 'ground', position: { x: 270, y: 370 }, data: { label: 'VSS' } },
      { id: 'out', type: 'output', position: { x: 480, y: 150 }, data: { label: 'out', value: 0 } },
    ] as DigiNode[],
    edges: [
      { id: 'e_a_p1', source: 'a', target: 'mp1', targetHandle: 't:g' },
      { id: 'e_a_n1', source: 'a', target: 'mn1', targetHandle: 't:g' },
      { id: 'e_b_p2', source: 'b', target: 'mp2', targetHandle: 't:g' },
      { id: 'e_b_n2', source: 'b', target: 'mn2', targetHandle: 't:g' },
      { id: 'e_vdd_p1', source: 'vdd', sourceHandle: 's:pos', target: 'mp1', targetHandle: 't:s' },
      { id: 'e_vdd_p2', source: 'vdd', sourceHandle: 's:pos', target: 'mp2', targetHandle: 't:s' },
      { id: 'e_p1_out', source: 'mp1', sourceHandle: 's:d', target: 'out' },
      { id: 'e_p2_out', source: 'mp2', sourceHandle: 's:d', target: 'out' },
      { id: 'e_n1_out', source: 'mn1', sourceHandle: 's:d', target: 'out' },
      { id: 'e_mid', source: 'mn1', sourceHandle: 's:s', target: 'mn2', targetHandle: 't:d' },
      { id: 'e_n2_gnd', source: 'mn2', sourceHandle: 's:s', target: 'gnd', targetHandle: 't:gnd' },
    ] as DigiEdge[],
  },
  symbolShape: 'RECTANGLE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const NOR_DEF: CustomComponentDefinition = {
  id: 'std-nor',
  name: 'NOR',
  description: 'CMOS NOR2: 2 PMOS in series, 2 NMOS in parallel.',
  category: 'Standard Cells',
  pins: [
    { id: 'a', label: 'A', type: 'INPUT', side: 'LEFT' },
    { id: 'b', label: 'B', type: 'INPUT', side: 'LEFT' },
    { id: 'out', label: 'Y', type: 'OUTPUT', side: 'RIGHT' },
  ],
  subcircuit: {
    nodes: [
      { id: 'a', type: 'input', position: { x: 40, y: 80 }, data: { label: 'a', value: 0 } },
      { id: 'b', type: 'input', position: { x: 40, y: 220 }, data: { label: 'b', value: 0 } },
      { id: 'vdd', type: 'vsource', position: { x: 240, y: 10 }, data: { label: 'VDD', param: 5 } },
      { id: 'mp1', type: 'pmos', position: { x: 250, y: 70 }, data: { label: 'MP1', width: 2.4, length: 0.18 } },
      { id: 'mp2', type: 'pmos', position: { x: 250, y: 160 }, data: { label: 'MP2', width: 2.4, length: 0.18 } },
      { id: 'mn1', type: 'nmos', position: { x: 170, y: 250 }, data: { label: 'MN1', width: 1.2, length: 0.18 } },
      { id: 'mn2', type: 'nmos', position: { x: 330, y: 250 }, data: { label: 'MN2', width: 1.2, length: 0.18 } },
      { id: 'gnd', type: 'ground', position: { x: 270, y: 370 }, data: { label: 'VSS' } },
      { id: 'out', type: 'output', position: { x: 480, y: 160 }, data: { label: 'out', value: 0 } },
    ] as DigiNode[],
    edges: [
      { id: 'e_a_p1', source: 'a', target: 'mp1', targetHandle: 't:g' },
      { id: 'e_a_n1', source: 'a', target: 'mn1', targetHandle: 't:g' },
      { id: 'e_b_p2', source: 'b', target: 'mp2', targetHandle: 't:g' },
      { id: 'e_b_n2', source: 'b', target: 'mn2', targetHandle: 't:g' },
      { id: 'e_vdd_p1', source: 'vdd', sourceHandle: 's:pos', target: 'mp1', targetHandle: 't:s' },
      { id: 'e_mid_p', source: 'mp1', sourceHandle: 's:d', target: 'mp2', targetHandle: 't:s' },
      { id: 'e_p2_out', source: 'mp2', sourceHandle: 's:d', target: 'out' },
      { id: 'e_n1_out', source: 'mn1', sourceHandle: 's:d', target: 'out' },
      { id: 'e_n2_out', source: 'mn2', sourceHandle: 's:d', target: 'out' },
      { id: 'e_n1_gnd', source: 'mn1', sourceHandle: 's:s', target: 'gnd', targetHandle: 't:gnd' },
      { id: 'e_n2_gnd', source: 'mn2', sourceHandle: 's:s', target: 'gnd', targetHandle: 't:gnd' },
    ] as DigiEdge[],
  },
  symbolShape: 'RECTANGLE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const AND_DEF: CustomComponentDefinition = {
  id: 'std-and',
  name: 'AND',
  description: 'AND built hierarchically from NAND + NOT cells (drill down to transistors).',
  category: 'Standard Cells',
  pins: [
    { id: 'a', label: 'A', type: 'INPUT', side: 'LEFT' },
    { id: 'b', label: 'B', type: 'INPUT', side: 'LEFT' },
    { id: 'out', label: 'Y', type: 'OUTPUT', side: 'RIGHT' },
  ],
  subcircuit: {
    nodes: [
      { id: 'a', type: 'input', position: { x: 40, y: 100 }, data: { label: 'a', value: 0 } },
      { id: 'b', type: 'input', position: { x: 40, y: 220 }, data: { label: 'b', value: 0 } },
      {
        id: 'nand1',
        type: 'customComponent',
        position: { x: 200, y: 140 },
        data: { label: 'NAND', value: {}, subcircuitRef: 'std-nand' },
      },
      {
        id: 'not1',
        type: 'customComponent',
        position: { x: 380, y: 140 },
        data: { label: 'NOT', value: {}, subcircuitRef: 'std-not' },
      },
      { id: 'out', type: 'output', position: { x: 540, y: 140 }, data: { label: 'out', value: 0 } },
    ] as DigiNode[],
    edges: [
      { id: 'e_a', source: 'a', target: 'nand1', targetHandle: 't:a' },
      { id: 'e_b', source: 'b', target: 'nand1', targetHandle: 't:b' },
      { id: 'e_mid', source: 'nand1', sourceHandle: 's:out', target: 'not1', targetHandle: 't:in' },
      { id: 'e_out', source: 'not1', sourceHandle: 's:out', target: 'out' },
    ] as DigiEdge[],
  },
  symbolShape: 'RECTANGLE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const OR_DEF: CustomComponentDefinition = {
  id: 'std-or',
  name: 'OR',
  description: 'OR built hierarchically from NOR + NOT cells (drill down to transistors).',
  category: 'Standard Cells',
  pins: [
    { id: 'a', label: 'A', type: 'INPUT', side: 'LEFT' },
    { id: 'b', label: 'B', type: 'INPUT', side: 'LEFT' },
    { id: 'out', label: 'Y', type: 'OUTPUT', side: 'RIGHT' },
  ],
  subcircuit: {
    nodes: [
      { id: 'a', type: 'input', position: { x: 40, y: 100 }, data: { label: 'a', value: 0 } },
      { id: 'b', type: 'input', position: { x: 40, y: 220 }, data: { label: 'b', value: 0 } },
      {
        id: 'nor1',
        type: 'customComponent',
        position: { x: 200, y: 140 },
        data: { label: 'NOR', value: {}, subcircuitRef: 'std-nor' },
      },
      {
        id: 'not1',
        type: 'customComponent',
        position: { x: 380, y: 140 },
        data: { label: 'NOT', value: {}, subcircuitRef: 'std-not' },
      },
      { id: 'out', type: 'output', position: { x: 540, y: 140 }, data: { label: 'out', value: 0 } },
    ] as DigiNode[],
    edges: [
      { id: 'e_a', source: 'a', target: 'nor1', targetHandle: 't:a' },
      { id: 'e_b', source: 'b', target: 'nor1', targetHandle: 't:b' },
      { id: 'e_mid', source: 'nor1', sourceHandle: 's:out', target: 'not1', targetHandle: 't:in' },
      { id: 'e_out', source: 'not1', sourceHandle: 's:out', target: 'out' },
    ] as DigiEdge[],
  },
  symbolShape: 'RECTANGLE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const XOR_DEF: CustomComponentDefinition = {
  id: 'std-xor',
  name: 'XOR',
  description: 'XOR built hierarchically from 4 NAND cells (drill down to transistors).',
  category: 'Standard Cells',
  pins: [
    { id: 'a', label: 'A', type: 'INPUT', side: 'LEFT' },
    { id: 'b', label: 'B', type: 'INPUT', side: 'LEFT' },
    { id: 'out', label: 'Y', type: 'OUTPUT', side: 'RIGHT' },
  ],
  subcircuit: {
    nodes: [
      { id: 'a', type: 'input', position: { x: 40, y: 80 }, data: { label: 'a', value: 0 } },
      { id: 'b', type: 'input', position: { x: 40, y: 280 }, data: { label: 'b', value: 0 } },
      {
        id: 'n1',
        type: 'customComponent',
        position: { x: 220, y: 180 },
        data: { label: 'NAND D', value: {}, subcircuitRef: 'std-nand' },
      },
      {
        id: 'n2',
        type: 'customComponent',
        position: { x: 400, y: 80 },
        data: { label: 'NAND E', value: {}, subcircuitRef: 'std-nand' },
      },
      {
        id: 'n3',
        type: 'customComponent',
        position: { x: 400, y: 280 },
        data: { label: 'NAND F', value: {}, subcircuitRef: 'std-nand' },
      },
      {
        id: 'n4',
        type: 'customComponent',
        position: { x: 580, y: 180 },
        data: { label: 'NAND XOR', value: {}, subcircuitRef: 'std-nand' },
      },
      { id: 'out', type: 'output', position: { x: 760, y: 180 }, data: { label: 'out', value: 0 } },
    ] as DigiNode[],
    edges: [
      { id: 'e_a_n1a', source: 'a', target: 'n1', targetHandle: 't:a' },
      { id: 'e_b_n1b', source: 'b', target: 'n1', targetHandle: 't:b' },
      { id: 'e_a_n2a', source: 'a', target: 'n2', targetHandle: 't:a' },
      { id: 'e_d_n2b', source: 'n1', sourceHandle: 's:out', target: 'n2', targetHandle: 't:b' },
      { id: 'e_b_n3a', source: 'b', target: 'n3', targetHandle: 't:a' },
      { id: 'e_d_n3b', source: 'n1', sourceHandle: 's:out', target: 'n3', targetHandle: 't:b' },
      { id: 'e_e_n4a', source: 'n2', sourceHandle: 's:out', target: 'n4', targetHandle: 't:a' },
      { id: 'e_f_n4b', source: 'n3', sourceHandle: 's:out', target: 'n4', targetHandle: 't:b' },
      { id: 'e_out', source: 'n4', sourceHandle: 's:out', target: 'out' },
    ] as DigiEdge[],
  },
  symbolShape: 'RECTANGLE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** All seeded transistor-built standard cells, dependency order first. */
export const STANDARD_CELL_DEFS: CustomComponentDefinition[] = [
  NOT_DEF,
  NAND_DEF,
  NOR_DEF,
  AND_DEF,
  OR_DEF,
  XOR_DEF,
];

/**
 * Read the personal library registry from storage.
 * @returns Stored custom component definitions (empty when unavailable)
 */
export function readLibrary(): CustomComponentDefinition[] {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CustomComponentDefinition[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * True when a definition id belongs to the seeded standard cells.
 * @param id - Custom component id
 * @returns Whether it is a `std-*` seed
 */
export function isStandardCellId(id: string): boolean {
  return id.startsWith('std-');
}

/**
 * Seed missing standard cells into the personal library (idempotent).
 * First run inserts all six; later runs only fill gaps so user edits and
 * deletions of seeded cells are respected once the version flag is set.
 * @returns All personal library definitions including the seeds
 */
export function ensureStandardCellsSeeded(): CustomComponentDefinition[] {
  const existing = readLibrary();
  const byId = new Map(existing.map((c) => [c.id, c]));
  const flagged = (() => {
    try {
      return localStorage.getItem(SEED_FLAG_KEY) === SEED_VERSION;
    } catch {
      return true;
    }
  })();

  let changed = false;
  if (!flagged) {
    for (const def of STANDARD_CELL_DEFS) {
      if (!byId.has(def.id)) {
        byId.set(def.id, def);
        changed = true;
      }
    }
    try {
      localStorage.setItem(LIB_KEY, JSON.stringify(Array.from(byId.values())));
      localStorage.setItem(SEED_FLAG_KEY, SEED_VERSION);
    } catch {
      /* storage unavailable */
    }
    try {
      window.dispatchEvent(new Event('digisim:library_updated'));
    } catch {
      /* non-DOM test env */
    }
  }
  void changed;
  return Array.from(byId.values());
}
