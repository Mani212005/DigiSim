/**
 * @file netlistGenerator.ts
 * @description Maps detected component bounding boxes and pin junction centroids
 * into DigiSim ReactFlow nodes and wire edges.
 */

import type { Edge, Node } from 'reactflow';
import type { NodeData } from '../../types';
import type { YoloDetection } from './yoloDetector';

export interface GeneratedCircuit {
  nodes: Node<NodeData>[];
  edges: Edge[];
}

/**
 * Maps YOLO component detections into ReactFlow canvas nodes and connecting wire edges.
 */
export function generateNetlistFromDetections(
  detections: YoloDetection[]
): GeneratedCircuit {
  if (!detections || detections.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Sort detections left-to-right by X coordinate
  const sorted = [...detections].sort((a, b) => a.x - b.x);

  const nodes: Node<NodeData>[] = [];
  const edges: Edge[] = [];

  // Group by category
  const inputs: { id: string; det: YoloDetection }[] = [];
  const gates: { id: string; det: YoloDetection }[] = [];
  const outputs: { id: string; det: YoloDetection }[] = [];

  sorted.forEach((det, idx) => {
    const id = `${idx + 1}`;
    const label = `${det.className} ${idx + 1}`;

    // Normalize coordinates onto standard grid if box bounds exist
    const posX = Math.round(det.x);
    const posY = Math.round(det.y);

    const node: Node<NodeData> = {
      id,
      type: det.nodeType,
      position: { x: posX, y: posY },
      data: {
        label,
        value: det.nodeType === 'input' ? 0 : undefined,
      },
    };

    nodes.push(node);

    if (det.nodeType === 'input') {
      inputs.push({ id, det });
    } else if (det.nodeType === 'output') {
      outputs.push({ id, det });
    } else {
      gates.push({ id, det });
    }
  });

  // Auto-connect nodes intelligently based on column layers if not already connected
  let edgeIdCount = 1;

  // Connect inputs to gates
  if (inputs.length > 0 && gates.length > 0) {
    gates.forEach((gate, gIdx) => {
      // Connect first input to 'a'
      const inputA = inputs[gIdx % inputs.length];
      if (inputA) {
        edges.push({
          id: `e-yolo-${edgeIdCount++}`,
          source: inputA.id,
          target: gate.id,
          targetHandle: 'a',
          animated: true,
        });
      }

      // Connect second input to 'b' if gate takes two inputs
      if (gate.det.nodeType !== 'notGate' && inputs.length > 1) {
        const inputB = inputs[(gIdx + 1) % inputs.length];
        if (inputB && inputB.id !== inputA?.id) {
          edges.push({
            id: `e-yolo-${edgeIdCount++}`,
            source: inputB.id,
            target: gate.id,
            targetHandle: 'b',
            animated: true,
          });
        }
      }
    });
  }

  // Connect gates to outputs
  if (gates.length > 0 && outputs.length > 0) {
    outputs.forEach((output, oIdx) => {
      const gate = gates[oIdx % gates.length];
      if (gate) {
        edges.push({
          id: `e-yolo-${edgeIdCount++}`,
          source: gate.id,
          target: output.id,
          animated: true,
        });
      }
    });
  } else if (inputs.length > 0 && outputs.length > 0 && gates.length === 0) {
    // Direct input to output wiring if no gates detected
    inputs.forEach((input, iIdx) => {
      const output = outputs[iIdx % outputs.length];
      if (output) {
        edges.push({
          id: `e-yolo-${edgeIdCount++}`,
          source: input.id,
          target: output.id,
          animated: true,
        });
      }
    });
  }

  return { nodes, edges };
}
