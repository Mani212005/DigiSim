import { generateNetlistFromDetections } from './netlistGenerator';
import type { YoloDetection } from './yoloDetector';

describe('netlistGenerator', () => {
  it('converts YOLO detections into ReactFlow nodes and connecting edges', () => {
    const mockDetections: YoloDetection[] = [
      {
        className: 'SWITCH',
        nodeType: 'input',
        confidence: 0.95,
        x: 100,
        y: 200,
        width: 80,
        height: 60,
        x1: 60,
        y1: 170,
        x2: 140,
        y2: 230,
      },
      {
        className: 'AND',
        nodeType: 'andGate',
        confidence: 0.90,
        x: 400,
        y: 200,
        width: 120,
        height: 90,
        x1: 340,
        y1: 155,
        x2: 460,
        y2: 245,
      },
      {
        className: 'LED',
        nodeType: 'output',
        confidence: 0.97,
        x: 700,
        y: 200,
        width: 70,
        height: 70,
        x1: 665,
        y1: 165,
        x2: 735,
        y2: 235,
      },
    ];

    const { nodes, edges } = generateNetlistFromDetections(mockDetections);

    expect(nodes.length).toBe(3);
    expect(nodes[0].type).toBe('input');
    expect(nodes[1].type).toBe('andGate');
    expect(nodes[2].type).toBe('output');

    expect(edges.length).toBeGreaterThan(0);
    expect(edges[0].source).toBe(nodes[0].id);
    expect(edges[0].target).toBe(nodes[1].id);
  });

  it('handles empty detections gracefully', () => {
    const { nodes, edges } = generateNetlistFromDetections([]);
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });
});
