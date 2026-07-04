/**
 * @file circuitAnalysis.ts
 * @description Pure circuit-analysis helpers that turn the canvas nodes/edges into
 * inspectable artifacts: independent circuits (connected components), truth tables,
 * netlists, and clean/raw JSON. Gate evaluation is delegated to runSimulation
 * (useLogicSimulation.ts) so gate logic is never duplicated (CLAUDE.md).
 */

import { runSimulation } from '../hooks/useLogicSimulation';
import type {
  Circuit,
  CircuitGraphExport,
  DigiEdge,
  DigiNode,
  NetlistCircuit,
  NetlistComponent,
  TruthTable,
  TruthTableColumn,
  TruthTableRow,
} from '../types';

/** Max primary inputs to enumerate (2^MAX_INPUTS rows) before truncating. */
export const MAX_TRUTH_TABLE_INPUTS = 10;

/**
 * Group nodes into connected components (edges treated as undirected).
 *
 * @param nodes - All canvas nodes.
 * @param edges - All canvas edges.
 * @returns Circuits containing at least one input and one output node, each named
 *   "Circuit N" and ordered by their smallest node id for stability.
 */
export function findCircuits(nodes: DigiNode[], edges: DigiEdge[]): Circuit[] {
  const parent = new Map<string, string>();
  nodes.forEach((n) => parent.set(n.id, n.id));

  const find = (a: string): string => {
    let root = a;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = a;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const edge of edges) {
    if (parent.has(edge.source) && parent.has(edge.target)) {
      union(edge.source, edge.target);
    }
  }

  const groups = new Map<string, string[]>();
  for (const node of nodes) {
    const root = find(node.id);
    const group = groups.get(root);
    if (group) group.push(node.id);
    else groups.set(root, [node.id]);
  }

  const typeById = new Map(nodes.map((n) => [n.id, n.type]));
  const idOrder = (id: string): number => {
    const num = Number(id);
    return Number.isFinite(num) ? num : Number.MAX_SAFE_INTEGER;
  };

  const circuits: Circuit[] = [];
  for (const nodeIds of Array.from(groups.values())) {
    const inputIds = nodeIds.filter((id) => typeById.get(id) === 'input');
    const outputIds = nodeIds.filter((id) => typeById.get(id) === 'output');
    if (inputIds.length === 0 || outputIds.length === 0) continue;
    circuits.push({
      id: `circuit-${nodeIds.slice().sort((a, b) => idOrder(a) - idOrder(b))[0]}`,
      name: '',
      nodeIds,
      inputIds,
      outputIds,
    });
  }

  // Order circuits by their smallest node id, then name them Circuit 1..N.
  circuits.sort(
    (a, b) =>
      Math.min(...a.nodeIds.map(idOrder)) - Math.min(...b.nodeIds.map(idOrder))
  );
  circuits.forEach((c, i) => {
    c.name = `Circuit ${i + 1}`;
  });
  return circuits;
}

/**
 * Build the ordered input/output columns for a circuit, de-duplicating labels.
 *
 * @param ids - Node ids (inputs or outputs) belonging to the circuit.
 * @param nodes - All canvas nodes.
 * @returns Columns sorted by label then id, with duplicate labels suffixed.
 */
function buildColumns(ids: string[], nodes: DigiNode[]): TruthTableColumn[] {
  const labelById = new Map(nodes.map((n) => [n.id, n.data.label]));
  const columns = ids
    .map((id) => ({ id, label: labelById.get(id) ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));

  const seen = new Map<string, number>();
  return columns.map((col) => {
    const count = seen.get(col.label) ?? 0;
    seen.set(col.label, count + 1);
    return count === 0 ? col : { ...col, label: `${col.label} (${count + 1})` };
  });
}

/**
 * Enumerate a circuit's truth table by driving every input combination through
 * the shared simulation evaluator.
 *
 * @param circuit - The circuit to evaluate.
 * @param nodes - All canvas nodes.
 * @param edges - All canvas edges.
 * @returns Truth table with input/output columns and one row per combination;
 *   `truncated` is true (rows empty) when inputs exceed MAX_TRUTH_TABLE_INPUTS.
 */
export function generateTruthTable(
  circuit: Circuit,
  nodes: DigiNode[],
  edges: DigiEdge[]
): TruthTable {
  const inputs = buildColumns(circuit.inputIds, nodes);
  const outputs = buildColumns(circuit.outputIds, nodes);

  if (inputs.length > MAX_TRUTH_TABLE_INPUTS) {
    return { inputs, outputs, rows: [], truncated: true };
  }

  const rows: TruthTableRow[] = [];
  const combos = 1 << inputs.length;
  for (let mask = 0; mask < combos; mask++) {
    // Bit i (MSB-first) drives input column i.
    const assignment = inputs.map((_, i) => (mask >> (inputs.length - 1 - i)) & 1);
    const overrides = new Map(inputs.map((col, i) => [col.id, assignment[i]]));
    const driven = nodes.map((n) =>
      overrides.has(n.id)
        ? { ...n, data: { ...n.data, value: overrides.get(n.id)! } }
        : n
    );
    const result = runSimulation(driven, edges);
    const valueById = new Map(result.map((n) => [n.id, n.data.value]));
    rows.push({
      inputs: assignment,
      outputs: outputs.map((col) => valueById.get(col.id) ?? 0),
    });
  }
  return { inputs, outputs, rows, truncated: false };
}

/**
 * Normalise a ReactFlow node type into a netlist type token, e.g. "andGate" →
 * "ANDGATE", "input" → "INPUT".
 *
 * @param type - ReactFlow node type.
 * @returns Uppercased type token.
 */
function netlistType(type: string | undefined): string {
  return (type ?? 'UNKNOWN').replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
}

/**
 * Build a netlist for one circuit: assign net names and list each gate/output
 * and the nets it connects.
 *
 * @param circuit - The circuit to describe.
 * @param nodes - All canvas nodes.
 * @param edges - All canvas edges.
 * @returns Structured netlist plus a ready-to-copy text rendering.
 */
export function buildNetlist(
  circuit: Circuit,
  nodes: DigiNode[],
  edges: DigiEdge[]
): NetlistCircuit {
  const nodeIds = new Set(circuit.nodeIds);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const localEdges = edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
  );

  // Assign a stable net name to every node that drives a wire.
  const idOrder = (id: string): number => {
    const num = Number(id);
    return Number.isFinite(num) ? num : Number.MAX_SAFE_INTEGER;
  };
  const ordered = circuit.nodeIds
    .slice()
    .sort((a, b) => idOrder(a) - idOrder(b));

  const netName = new Map<string, string>();
  let gateCounter = 0;
  for (const id of ordered) {
    const node = nodeById.get(id);
    if (!node) continue;
    if (node.type === 'input') {
      netName.set(id, node.data.label.replace(/^input\s+/i, '').trim() || id);
    } else if (node.type !== 'output') {
      netName.set(id, `n${(gateCounter += 1)}`);
    }
  }

  const incoming = (targetId: string): string[] =>
    localEdges
      .filter((e) => e.target === targetId)
      .sort((a, b) => (a.targetHandle ?? '').localeCompare(b.targetHandle ?? ''))
      .map((e) => netName.get(e.source) ?? '?');

  const components: NetlistComponent[] = [];
  let uCounter = 0;
  let outCounter = 0;
  for (const id of ordered) {
    const node = nodeById.get(id);
    if (!node || node.type === 'input') continue;
    if (node.type === 'output') {
      components.push({
        ref: `OUT${(outCounter += 1)}`,
        type: netlistType(node.type),
        inputs: incoming(id),
        output: null,
      });
    } else {
      components.push({
        ref: `U${(uCounter += 1)}`,
        type: netlistType(node.type),
        inputs: incoming(id),
        output: netName.get(id) ?? null,
      });
    }
  }

  const inputNets = circuit.inputIds
    .map((id) => netName.get(id) ?? id)
    .sort((a, b) => a.localeCompare(b));

  const lines = [
    `# ${circuit.name}`,
    `inputs: [${inputNets.join(', ')}]`,
    ...components.map((c) => {
      const io = c.output ? `out=${c.output}` : '';
      return `${c.ref}: ${c.type}  in=[${c.inputs.join(', ')}]  ${io}`.trimEnd();
    }),
  ];

  return {
    circuitId: circuit.id,
    name: circuit.name,
    inputs: inputNets,
    components,
    text: lines.join('\n'),
  };
}

/**
 * Produce the clean (portable) and raw (ReactFlow) JSON renderings for a circuit.
 *
 * @param circuit - The circuit to export.
 * @param nodes - All canvas nodes.
 * @param edges - All canvas edges.
 * @returns Clean components/connections graph and the raw filtered nodes/edges.
 */
export function buildCircuitGraph(
  circuit: Circuit,
  nodes: DigiNode[],
  edges: DigiEdge[]
): CircuitGraphExport {
  const nodeIds = new Set(circuit.nodeIds);
  const rawNodes = nodes.filter((n) => nodeIds.has(n.id));
  const rawEdges = edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
  );

  return {
    clean: {
      components: rawNodes.map((n) => ({
        id: n.id,
        type: n.type ?? 'unknown',
        label: n.data.label,
        x: Math.round(n.position.x),
        y: Math.round(n.position.y),
      })),
      connections: rawEdges.map((e) => ({
        from: e.source,
        to: e.target,
        fromPort: e.sourceHandle ?? null,
        toPort: e.targetHandle ?? null,
      })),
    },
    raw: { nodes: rawNodes, edges: rawEdges },
  };
}
