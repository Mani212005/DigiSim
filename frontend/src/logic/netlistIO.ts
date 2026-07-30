/**
 * @file netlistIO.ts
 * @description Pure export/import logic for DigiSim's canonical JSON netlist format.
 * Export serializes the canvas into portable connectivity (components + connections);
 * import validates a netlist document and reconstructs node/edge blueprints.
 */

import type {
  CircuitNodeType,
  DigiEdge,
  DigiNode,
  NetlistExportComponent,
  NetlistExportConnection,
  NetlistExportJSON,
  NetlistImportEdge,
  NetlistImportNode,
  NetlistParseResult,
} from '../types';

const LAYER_X = 260;
const ROW_Y = 150;

function idOrder(id: string): number {
  const num = Number(id);
  return Number.isFinite(num) ? num : Number.MAX_SAFE_INTEGER;
}

export function exportNetlist(
  nodes: DigiNode[],
  edges: DigiEdge[],
  circuitName: string
): NetlistExportJSON {
  const ordered = nodes.slice().sort((a, b) => idOrder(a.id) - idOrder(b.id));
  
  const validNodes = ordered.filter(n => n.type);
  const nodeMap = new Map(validNodes.map(n => [n.id, n]));
  const validEdges = edges.filter(e => nodeMap.has(e.source) && nodeMap.has(e.target));
  
  const idToCompId = new Map(validNodes.map(n => [n.id, `${n.type || 'comp'}_${n.id}`]));

  const components: NetlistExportComponent[] = validNodes.map(n => ({
    id: idToCompId.get(n.id)!,
    type: (n.type || 'unknown').toUpperCase(),
    label: n.data.label || n.type || 'Unknown',
    x: Math.round(n.position.x),
    y: Math.round(n.position.y)
  }));

  const connections: NetlistExportConnection[] = validEdges.map(e => {
    const sourceComp = idToCompId.get(e.source)!;
    const targetComp = idToCompId.get(e.target)!;
    const fromPort = e.sourceHandle ? `${sourceComp}.${e.sourceHandle}` : `${sourceComp}.out`;
    const toPort = e.targetHandle ? `${targetComp}.${e.targetHandle}` : `${targetComp}.in`;
    return {
      from: fromPort,
      to: toPort
    };
  });

  return {
    circuit_name: circuitName,
    components,
    connections
  };
}

export function parseNetlist(raw: unknown): NetlistParseResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['netlist must be a JSON object'] };
  }
  const doc = raw as Record<string, unknown>;

  const circuitName = typeof doc.circuit_name === 'string' && doc.circuit_name.trim()
    ? doc.circuit_name.trim() : null;
  if (!circuitName) {
    errors.push("'circuit_name' must be a non-empty string");
  }
  if (!Array.isArray(doc.components)) {
    errors.push("'components' must be an array");
  }
  if (!Array.isArray(doc.connections)) {
    errors.push("'connections' must be an array");
  }

  if (errors.length > 0) return { ok: false, errors };

  const parsedNodes: NetlistImportNode[] = [];
  const parsedEdges: NetlistImportEdge[] = [];
  
  const compIdMap = new Map<string, NetlistImportNode>();
  const connectionsList = doc.connections as unknown[];

  let layerCount = 0;
  
  (doc.components as unknown[]).forEach((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      errors.push(`component #${i + 1} must be an object`);
      return;
    }
    const c = entry as NetlistExportComponent;
    if (!c.id || typeof c.id !== 'string') {
      errors.push(`component #${i + 1} is missing a string 'id'`);
      return;
    }
    if (compIdMap.has(c.id)) {
      errors.push(`duplicate component id '${c.id}'`);
      return;
    }
    
    // Convert uppercase back to the original type strings
    let originalType = c.type.toLowerCase();
    if (originalType.endsWith('gate')) {
      originalType = originalType.replace('gate', 'Gate');
    }

    const nodeType = originalType as CircuitNodeType;
    
    const node: NetlistImportNode = {
      key: `comp:${c.id}`,
      type: nodeType,
      label: c.label || nodeType,
      x: typeof c.x === 'number' ? c.x : (layerCount % 5) * LAYER_X,
      y: typeof c.y === 'number' ? c.y : Math.floor(layerCount / 5) * ROW_Y
    };
    layerCount++;
    compIdMap.set(c.id, node);
    parsedNodes.push(node);
  });

  connectionsList.forEach((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      errors.push(`connection #${i + 1} must be an object`);
      return;
    }
    const conn = entry as NetlistExportConnection;
    if (!conn.from || typeof conn.from !== 'string') {
      errors.push(`connection #${i + 1} is missing a string 'from'`);
      return;
    }
    if (!conn.to || typeof conn.to !== 'string') {
      errors.push(`connection #${i + 1} is missing a string 'to'`);
      return;
    }
    
    const [fromCompId, fromHandle] = conn.from.split('.');
    const [toCompId, toHandle] = conn.to.split('.');

    if (!compIdMap.has(fromCompId)) {
      errors.push(`connection from unknown component '${fromCompId}'`);
      return;
    }
    if (!compIdMap.has(toCompId)) {
      errors.push(`connection to unknown component '${toCompId}'`);
      return;
    }

    let targetHandle: 'a' | 'b' | null = null;
    if (toHandle === 'a') targetHandle = 'a';
    else if (toHandle === 'b') targetHandle = 'b';
    
    parsedEdges.push({
      sourceKey: `comp:${fromCompId}`,
      targetKey: `comp:${toCompId}`,
      targetHandle: targetHandle,
    });
  });

  if (errors.length > 0) return { ok: false, errors };
  
  return {
    ok: true,
    circuitName: circuitName!,
    nodes: parsedNodes,
    edges: parsedEdges
  };
}
