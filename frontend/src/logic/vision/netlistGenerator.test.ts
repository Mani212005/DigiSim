import { generateNetlistFromDetections } from './netlistGenerator';
import type { YoloDetection } from './yoloDetector';

describe('netlistGenerator unit tests', () => {
  test('generates valid DigiSim nodes and edges from YOLO detections', () => {
    const detections: YoloDetection[] = [
      {
        id: 'det_in1',
        className: 'INPUT',
        nodeType: 'input',
        label: 'Input Switch A',
        confidence: 0.95,
        x: 100,
        y: 150,
        width: 80,
        height: 60,
        x1: 60,
        y1: 120,
        x2: 140,
        y2: 180,
      },
      {
        id: 'det_in2',
        className: 'INPUT',
        nodeType: 'input',
        label: 'Input Switch B',
        confidence: 0.92,
        x: 100,
        y: 350,
        width: 80,
        height: 60,
        x1: 60,
        y1: 320,
        x2: 140,
        y2: 380,
      },
      {
        id: 'det_and',
        className: 'AND',
        nodeType: 'andGate',
        label: 'AND Gate',
        confidence: 0.88,
        x: 400,
        y: 250,
        width: 120,
        height: 80,
        x1: 340,
        y1: 210,
        x2: 460,
        y2: 290,
      },
      {
        id: 'det_out',
        className: 'OUTPUT',
        nodeType: 'output',
        label: 'Output LED',
        confidence: 0.94,
        x: 800,
        y: 250,
        width: 80,
        height: 80,
        x1: 760,
        y1: 210,
        x2: 840,
        y2: 290,
      },
    ];

    const blueprint = generateNetlistFromDetections(detections, 1000, 800);

    expect(blueprint.nodes.length).toBe(4);
    expect(blueprint.edges.length).toBe(3);

    const nodeTypes = blueprint.nodes.map((n) => n.type);
    expect(nodeTypes).toContain('input');
    expect(nodeTypes).toContain('andGate');
    expect(nodeTypes).toContain('output');

    // Check edge connection targets
    const andNode = blueprint.nodes.find((n) => n.type === 'andGate')!;
    const outNode = blueprint.nodes.find((n) => n.type === 'output')!;

    const edgesToAnd = blueprint.edges.filter((e) => e.target === andNode.id);
    expect(edgesToAnd.length).toBe(2);

    const edgeToOut = blueprint.edges.find((e) => e.target === outNode.id);
    expect(edgeToOut?.source).toBe(andNode.id);
  });
});
