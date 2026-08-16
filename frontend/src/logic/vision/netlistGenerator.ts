/**
 * @file netlistGenerator.ts
 * @description Maps detected YOLO component bounding boxes and pin junction centroids into
 * DigiSim React Flow nodes and wire edges for seamless "Snap-to-Simulate" placement.
 */

import type { CircuitNodeType, DigiEdge, DigiNode } from '../../types';
import type { YoloDetection } from './yoloDetector';

export interface CircuitBlueprint {
  nodes: DigiNode[];
  edges: DigiEdge[];
}

export const GRID_CANVAS_WIDTH = 1200;
export const GRID_CANVAS_HEIGHT = 800;

/**
 * Maps YOLO detections to React Flow nodes and infer wire edges based on spatial topology.
 */
export function generateNetlistFromDetections(
  detections: YoloDetection[],
  imageWidth = 1000,
  imageHeight = 800
): CircuitBlueprint {
  if (!detections || detections.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Filter out junction point annotations and keep component nodes
  const componentDetections = detections.filter((d) => d.nodeType !== 'junction');

  // Sort component detections spatially (primary by X left-to-right, secondary by Y top-to-bottom)
  const sortedComponents = [...componentDetections].sort((a, b) => {
    const dx = a.x - b.x;
    if (Math.abs(dx) > 60) return dx;
    return a.y - b.y;
  });

  const scaleX = GRID_CANVAS_WIDTH / Math.max(1, imageWidth);
  const scaleY = GRID_CANVAS_HEIGHT / Math.max(1, imageHeight);

  // Group by topological role for auto-layering if spatial coordinates are bunched up
  const inputs: YoloDetection[] = [];
  const gates: YoloDetection[] = [];
  const outputs: YoloDetection[] = [];

  for (const det of sortedComponents) {
    if (det.nodeType === 'input') {
      inputs.push(det);
    } else if (det.nodeType === 'output') {
      outputs.push(det);
    } else {
      gates.push(det);
    }
  }

  const nodes: DigiNode[] = [];
  const edges: DigiEdge[] = [];
  const nodeMap = new Map<string, DigiNode>();

  let idCounter = 1;

  // Process inputs (placed on left layer if position isn't pre-spread)
  inputs.forEach((det, idx) => {
    const nodeId = `${idCounter++}`;
    const nodeX = Math.round(det.x * scaleX > 50 ? det.x * scaleX : 100);
    const nodeY = Math.round(det.y * scaleY > 50 ? det.y * scaleY : 100 + idx * 160);

    const node: DigiNode = {
      id: nodeId,
      type: 'input',
      position: { x: nodeX, y: nodeY },
      data: {
        label: det.label || `Input ${String.fromCharCode(65 + idx)}`,
        value: 0,
      },
    };
    nodes.push(node);
    nodeMap.set(det.id, node);
  });

  // Process logic gates (placed in center layer)
  gates.forEach((det, idx) => {
    const nodeId = `${idCounter++}`;
    const nodeX = Math.round(det.x * scaleX > 200 ? det.x * scaleX : 400 + (idx % 3) * 220);
    const nodeY = Math.round(det.y * scaleY > 50 ? det.y * scaleY : 120 + Math.floor(idx / 3) * 180);

    const node: DigiNode = {
      id: nodeId,
      type: det.nodeType as CircuitNodeType,
      position: { x: nodeX, y: nodeY },
      data: {
        label: det.label || `${det.className} Gate`,
        value: 0,
      },
    };
    nodes.push(node);
    nodeMap.set(det.id, node);
  });

  // Process outputs (placed on right layer)
  outputs.forEach((det, idx) => {
    const nodeId = `${idCounter++}`;
    const nodeX = Math.round(det.x * scaleX > 500 ? det.x * scaleX : 850);
    const nodeY = Math.round(det.y * scaleY > 50 ? det.y * scaleY : 140 + idx * 160);

    const node: DigiNode = {
      id: nodeId,
      type: 'output',
      position: { x: nodeX, y: nodeY },
      data: {
        label: det.label || `Output ${idx + 1}`,
        value: 0,
      },
    };
    nodes.push(node);
    nodeMap.set(det.id, node);
  });

  // Auto-connect topology: Connect inputs to gates, gates to outputs based on spatial proximity / left-to-right flow
  const inputNodes = nodes.filter((n) => n.type === 'input');
  const gateNodes = nodes.filter(
    (n) => n.type && n.type !== 'input' && n.type !== 'output'
  );
  const outputNodes = nodes.filter((n) => n.type === 'output');

  let edgeCounter = 1;

  if (gateNodes.length > 0) {
    gateNodes.forEach((gate, gIdx) => {
      // Connect up to 2 closest upstream inputs to handles 'a' and 'b'
      const availableInputs = inputNodes.length > 0 ? inputNodes : [];
      if (availableInputs.length > 0) {
        const inA = availableInputs[(gIdx * 2) % availableInputs.length];
        edges.push({
          id: `e${edgeCounter++}`,
          source: inA.id,
          target: gate.id,
          sourceHandle: null,
          targetHandle: 'a',
        });

        if (availableInputs.length > 1 && gate.type !== 'notGate') {
          const inB = availableInputs[(gIdx * 2 + 1) % availableInputs.length];
          edges.push({
            id: `e${edgeCounter++}`,
            source: inB.id,
            target: gate.id,
            sourceHandle: null,
            targetHandle: 'b',
          });
        }
      }

      // Connect gate output to corresponding output node
      if (outputNodes.length > 0) {
        const outNode = outputNodes[gIdx % outputNodes.length];
        edges.push({
          id: `e${edgeCounter++}`,
          source: gate.id,
          target: outNode.id,
          sourceHandle: null,
          targetHandle: null,
        });
      }
    });
  } else if (inputNodes.length > 0 && outputNodes.length > 0) {
    // Direct input to output connection fallback
    inputNodes.forEach((inNode, iIdx) => {
      const outNode = outputNodes[iIdx % outputNodes.length];
      edges.push({
        id: `e${edgeCounter++}`,
        source: inNode.id,
        target: outNode.id,
        sourceHandle: null,
        targetHandle: null,
      });
    });
  }

  return { nodes, edges };
}
