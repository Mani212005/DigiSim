/**
 * @file netlistIO.ts
 * @description Pure export/import logic for DigiSim's canonical JSON netlist format.
 * Export serializes the canvas into portable connectivity (components + nets + io);
 * import validates a netlist document with specific error messages and reconstructs
 * id-agnostic node/edge blueprints (App assigns real ids), auto-laying-out positions
 * by topological layer when none are given. No gate evaluation happens here.
 */

import type {
  CircuitNodeType,
  DigiEdge,
  DigiNode,
  NetlistExportComponent,
  NetlistExportJSON,
  NetlistImportEdge,
  NetlistImportNode,
  NetlistParseResult,
} from '../types';

/** Netlist type token per gate node type (e.g. andGate → AND_GATE). */
const TOKEN_BY_GATE_TYPE: Record<string, string> = {
  andGate: 'AND_GATE',
  orGate: 'OR_GATE',
  notGate: 'NOT_GATE',
  nandGate: 'NAND_GATE',
  norGate: 'NOR_GATE',
  xorGate: 'XOR_GATE',
  xnorGate: 'XNOR_GATE',
};

/** Node type + canvas label per netlist type token (inverse of TOKEN_BY_GATE_TYPE). */
const GATE_BY_TOKEN: Record<string, { type: CircuitNodeType; label: string }> = {
  AND_GATE: { type: 'andGate', label: 'AND Gate' },
  OR_GATE: { type: 'orGate', label: 'OR Gate' },
  NOT_GATE: { type: 'notGate', label: 'NOT Gate' },
  NAND_GATE: { type: 'nandGate', label: 'NAND Gate' },
  NOR_GATE: { type: 'norGate', label: 'NOR Gate' },
  XOR_GATE: { type: 'xorGate', label: 'XOR Gate' },
  XNOR_GATE: { type: 'xnorGate', label: 'XNOR Gate' },
};

/** Horizontal / vertical spacing of the auto-layout grid (matches initialNodes). */
const LAYER_X = 260;
const ROW_Y = 150;

/**
 * Sort node ids numerically where possible (canvas ids are numeric strings).
 *
 * @param id - Node id.
 * @returns Numeric sort key.
 */
function idOrder(id: string): number {
  const num = Number(id);
  return Number.isFinite(num) ? num : Number.MAX_SAFE_INTEGER;
}

/**
 * Turn a node label into a net-name candidate (trimmed, whitespace → underscores).
 *
 * @param label - Raw node label.
 * @returns Sanitized candidate, possibly empty.
 */
function sanitizeNet(label: string): string {
  return label.trim().replace(/\s+/g, '_');
}

/**
 * Reserve a unique net name, suffixing "_2", "_3", … on collisions.
 *
 * @param candidate - Preferred name (may be empty).
 * @param fallback - Name used when the candidate is empty.
 * @param used - Set of already-reserved names (mutated).
 * @returns The reserved, unique net name.
 */
function reserveNet(candidate: string, fallback: string, used: Set<string>): string {
  const base = candidate || fallback;
  let name = base;
  let suffix = 2;
  while (used.has(name)) {
    name = `${base}_${suffix++}`;
  }
  used.add(name);
  return name;
}

/**
 * Serialize the whole canvas into the canonical JSON netlist format.
 *
 * Net naming: input nodes keep their label (minus an "Input " prefix); a gate
 * output that feeds an output node takes that node's label (or "OUT1…" when the
 * label is the default "Output"); remaining internal nets are "N1, N2…".
 * Unknown node types (e.g. unmapped cloud detections) are skipped.
 *
 * @param nodes - All canvas nodes.
 * @param edges - All canvas edges.
 * @param circuitName - Value for the netlist's circuit_name field.
 * @returns Canonical netlist document (positions intentionally omitted).
 */
export function exportNetlist(
  nodes: DigiNode[],
  edges: DigiEdge[],
  circuitName: string
): NetlistExportJSON {
  const ordered = nodes.slice().sort((a, b) => idOrder(a.id) - idOrder(b.id));
  const inputNodes = ordered.filter((n) => n.type === 'input');
  const outputNodes = ordered.filter((n) => n.type === 'output');
  const gateNodes = ordered.filter((n) => TOKEN_BY_GATE_TYPE[n.type ?? ''] !== undefined);

  const known = new Set([...inputNodes, ...outputNodes, ...gateNodes].map((n) => n.id));
  const wires = edges.filter((e) => known.has(e.source) && known.has(e.target));

  // Net per driving node: inputs by label, gates by fed-output label or N#.
  const used = new Set<string>();
  const netByNode = new Map<string, string>();
  inputNodes.forEach((n, i) => {
    const candidate = sanitizeNet(n.data.label.replace(/^input\s+/i, ''));
    netByNode.set(n.id, reserveNet(candidate, `IN${i + 1}`, used));
  });

  const outputById = new Map(outputNodes.map((n) => [n.id, n]));
  let internalCount = 0;
  let outCount = 0;
  for (const gate of gateNodes) {
    const fedOutput = wires.find((e) => e.source === gate.id && outputById.has(e.target));
    if (fedOutput) {
      const label = outputById.get(fedOutput.target)!.data.label;
      const candidate = sanitizeNet(label.replace(/^output\s*/i, ''));
      netByNode.set(gate.id, reserveNet(candidate, `OUT${(outCount += 1)}`, used));
    } else {
      netByNode.set(gate.id, reserveNet('', `N${(internalCount += 1)}`, used));
    }
  }

  const components: NetlistExportComponent[] = gateNodes.map((gate, i) => ({
    id: `U${i + 1}`,
    type: TOKEN_BY_GATE_TYPE[gate.type ?? ''],
    inputs: wires
      .filter((e) => e.target === gate.id)
      .sort((a, b) => (a.targetHandle ?? '').localeCompare(b.targetHandle ?? ''))
      .map((e) => netByNode.get(e.source) ?? '?'),
    output: netByNode.get(gate.id) ?? '?',
  }));

  // io.outputs = nets consumed by output nodes (deduped, in output-node order).
  const outputNets: string[] = [];
  for (const out of outputNodes) {
    const feed = wires.find((e) => e.target === out.id);
    if (!feed) continue;
    const net = netByNode.get(feed.source);
    if (net && !outputNets.includes(net)) outputNets.push(net);
  }

  const inputNets = inputNodes.map((n) => netByNode.get(n.id)!);
  const nets = [...inputNets, ...gateNodes.map((g) => netByNode.get(g.id)!)];

  return {
    circuit_name: circuitName,
    components,
    nets,
    io: { inputs: inputNets, outputs: outputNets },
  };
}

/**
 * Narrow an unknown value to a string array.
 *
 * @param value - Candidate value.
 * @returns True when value is an array of strings.
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Validate a netlist document and reconstruct canvas-ready node/edge blueprints.
 *
 * All structural problems are collected (not fail-fast) with specific messages,
 * e.g. "net 'N2' referenced but never defined". On success, nodes carry
 * auto-layout positions (topological layering) unless a component specifies x/y.
 *
 * @param raw - Parsed JSON value of unknown shape (caller handles JSON.parse errors).
 * @returns ok+blueprints on success, or the full list of validation errors.
 */
export function parseNetlist(raw: unknown): NetlistParseResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['netlist must be a JSON object'] };
  }
  const doc = raw as Record<string, unknown>;

  const circuitName =
    typeof doc.circuit_name === 'string' && doc.circuit_name.trim()
      ? doc.circuit_name.trim()
      : null;
  if (circuitName === null) {
    errors.push("'circuit_name' must be a non-empty string");
  }
  if (!Array.isArray(doc.components)) {
    errors.push("'components' must be an array");
  }
  if (!isStringArray(doc.nets)) {
    errors.push("'nets' must be an array of strings");
  }
  const io = doc.io as Record<string, unknown> | undefined;
  if (
    typeof doc.io !== 'object' ||
    doc.io === null ||
    !isStringArray(io?.inputs) ||
    !isStringArray(io?.outputs)
  ) {
    errors.push("'io' must be an object with 'inputs' and 'outputs' string arrays");
  }
  if (errors.length > 0) return { ok: false, errors };

  const components = doc.components as unknown[];
  const nets = doc.nets as string[];
  const ioInputs = (io as { inputs: string[] }).inputs;
  const ioOutputs = (io as { outputs: string[] }).outputs;

  // --- Per-component shape, type, and arity checks -------------------------
  interface ParsedComponent {
    id: string;
    token: string;
    inputs: string[];
    output: string;
    x?: number;
    y?: number;
  }
  const parsed: ParsedComponent[] = [];
  const seenIds = new Set<string>();
  components.forEach((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      errors.push(`component #${i + 1} must be an object`);
      return;
    }
    const c = entry as Record<string, unknown>;
    const cid = typeof c.id === 'string' && c.id.trim() ? c.id.trim() : null;
    if (cid === null) {
      errors.push(`component #${i + 1} is missing a string 'id'`);
      return;
    }
    if (seenIds.has(cid)) {
      errors.push(`duplicate component id '${cid}'`);
      return;
    }
    seenIds.add(cid);

    const token = typeof c.type === 'string' ? c.type.trim().toUpperCase() : '';
    if (!GATE_BY_TOKEN[token]) {
      errors.push(`component '${cid}' has unknown type '${String(c.type)}'`);
      return;
    }
    if (!isStringArray(c.inputs)) {
      errors.push(`component '${cid}' must have an 'inputs' array of net names`);
      return;
    }
    if (typeof c.output !== 'string' || !c.output.trim()) {
      errors.push(`component '${cid}' must have a string 'output' net`);
      return;
    }
    const arity = token === 'NOT_GATE' ? 1 : 2;
    if (c.inputs.length !== arity) {
      errors.push(
        `component '${cid}' (${token}) expects ${arity} input${arity === 1 ? '' : 's'}, got ${c.inputs.length}`
      );
      return;
    }
    parsed.push({
      id: cid,
      token,
      inputs: c.inputs,
      output: c.output.trim(),
      x: typeof c.x === 'number' ? c.x : undefined,
      y: typeof c.y === 'number' ? c.y : undefined,
    });
  });

  // --- Net definition and driver checks -------------------------------------
  const netSet = new Set<string>();
  for (const net of nets) {
    if (netSet.has(net)) errors.push(`net '${net}' listed more than once in 'nets'`);
    netSet.add(net);
  }
  const requireDefined = (net: string): void => {
    if (!netSet.has(net)) errors.push(`net '${net}' referenced but never defined`);
  };
  ioInputs.forEach(requireDefined);
  ioOutputs.forEach(requireDefined);
  parsed.forEach((c) => {
    c.inputs.forEach(requireDefined);
    requireDefined(c.output);
  });

  // Every net must have exactly one driver: an io input or a component output.
  const driverByNet = new Map<string, { kind: 'io' } | { kind: 'comp'; comp: ParsedComponent }>();
  const addDriver = (
    net: string,
    driver: { kind: 'io' } | { kind: 'comp'; comp: ParsedComponent }
  ): void => {
    if (driverByNet.has(net)) {
      errors.push(`net '${net}' is driven by multiple sources`);
    } else {
      driverByNet.set(net, driver);
    }
  };
  ioInputs.forEach((net) => addDriver(net, { kind: 'io' }));
  parsed.forEach((c) => addDriver(c.output, { kind: 'comp', comp: c }));
  for (const net of Array.from(netSet)) {
    if (!driverByNet.has(net)) {
      errors.push(`net '${net}' is never driven (not an io input and no component output)`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // --- Topological layering (also detects combinational loops) --------------
  const layerByComp = new Map<string, number>();
  const visiting = new Set<string>();
  /**
   * Layer of the component driving a net (io inputs sit at layer 0).
   * @param net - Net name.
   * @returns Topological layer of the net's driver, or null on a loop.
   */
  const netLayer = (net: string): number | null => {
    const driver = driverByNet.get(net)!;
    if (driver.kind === 'io') return 0;
    return compLayer(driver.comp);
  };
  /**
   * Longest-path layer of a component (1 + deepest input driver).
   * @param comp - Parsed component.
   * @returns Layer index, or null when a combinational loop is found.
   */
  const compLayer = (comp: ParsedComponent): number | null => {
    const cached = layerByComp.get(comp.id);
    if (cached !== undefined) return cached;
    if (visiting.has(comp.id)) {
      errors.push(`combinational loop detected involving component '${comp.id}'`);
      return null;
    }
    visiting.add(comp.id);
    let depth = 0;
    for (const net of comp.inputs) {
      const layer = netLayer(net);
      if (layer === null) return null;
      depth = Math.max(depth, layer);
    }
    visiting.delete(comp.id);
    const layer = depth + 1;
    layerByComp.set(comp.id, layer);
    return layer;
  };
  for (const comp of parsed) {
    if (compLayer(comp) === null) return { ok: false, errors };
  }

  // --- Reconstruction with auto-layout ---------------------------------------
  const rowByLayer = new Map<number, number>();
  /**
   * Next auto-layout position in a layer's column.
   * @param layer - Topological layer index.
   * @returns Canvas position for the next node in that layer.
   */
  const place = (layer: number): { x: number; y: number } => {
    const row = rowByLayer.get(layer) ?? 0;
    rowByLayer.set(layer, row + 1);
    return { x: layer * LAYER_X, y: row * ROW_Y };
  };

  const nodes: NetlistImportNode[] = [];
  const importEdges: NetlistImportEdge[] = [];
  const keyByNet = new Map<string, string>();

  for (const net of ioInputs) {
    const key = `in:${net}`;
    keyByNet.set(net, key);
    nodes.push({ key, type: 'input', label: net, ...place(0) });
  }
  for (const comp of parsed) {
    const key = `comp:${comp.id}`;
    keyByNet.set(comp.output, key);
    const gate = GATE_BY_TOKEN[comp.token];
    const auto = place(layerByComp.get(comp.id)!);
    nodes.push({
      key,
      type: gate.type,
      label: gate.label,
      x: comp.x ?? auto.x,
      y: comp.y ?? auto.y,
    });
  }
  for (const comp of parsed) {
    comp.inputs.forEach((net, i) => {
      importEdges.push({
        sourceKey: keyByNet.get(net)!,
        targetKey: `comp:${comp.id}`,
        targetHandle: i === 0 ? 'a' : 'b',
      });
    });
  }
  ioOutputs.forEach((net, i) => {
    const key = `out:${i}:${net}`;
    const layer = (netLayer(net) ?? 0) + 1;
    nodes.push({ key, type: 'output', label: net, ...place(layer) });
    importEdges.push({ sourceKey: keyByNet.get(net)!, targetKey: key, targetHandle: null });
  });

  return { ok: true, circuitName: circuitName!, nodes, edges: importEdges };
}
