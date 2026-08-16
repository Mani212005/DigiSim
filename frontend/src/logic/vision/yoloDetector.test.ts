import * as ort from 'onnxruntime-web';
import {
  applyNMS,
  computeIoU,
  parseYoloOutput,
  type YoloDetection,
} from './yoloDetector';

describe('yoloDetector unit tests', () => {
  test('computeIoU calculates correct bounding box overlap', () => {
    const boxA: YoloDetection = {
      id: 'a',
      className: 'AND',
      nodeType: 'andGate',
      label: 'AND Gate',
      confidence: 0.9,
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      x1: 50,
      y1: 50,
      x2: 150,
      y2: 150,
    };

    const boxB: YoloDetection = {
      id: 'b',
      className: 'AND',
      nodeType: 'andGate',
      label: 'AND Gate',
      confidence: 0.8,
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      x1: 50,
      y1: 50,
      x2: 150,
      y2: 150,
    };

    expect(computeIoU(boxA, boxB)).toBeCloseTo(1.0);
  });

  test('applyNMS suppresses overlapping detections', () => {
    const det1: YoloDetection = {
      id: '1',
      className: 'AND',
      nodeType: 'andGate',
      label: 'AND Gate',
      confidence: 0.95,
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      x1: 50,
      y1: 50,
      x2: 150,
      y2: 150,
    };

    const det2: YoloDetection = {
      id: '2',
      className: 'AND',
      nodeType: 'andGate',
      label: 'AND Gate',
      confidence: 0.85,
      x: 105,
      y: 105,
      width: 100,
      height: 100,
      x1: 55,
      y1: 55,
      x2: 155,
      y2: 155,
    };

    const det3: YoloDetection = {
      id: '3',
      className: 'OR',
      nodeType: 'orGate',
      label: 'OR Gate',
      confidence: 0.9,
      x: 400,
      y: 400,
      width: 100,
      height: 100,
      x1: 350,
      y1: 350,
      x2: 450,
      y2: 450,
    };

    const nms = applyNMS([det1, det2, det3], 0.45);
    expect(nms.length).toBe(2);
    expect(nms.map((d) => d.id)).toEqual(['1', '3']);
  });

  test('parseYoloOutput parses output tensors', () => {
    // 4621 channels x 8400 anchors float32 tensor mock
    const anchors = 10;
    const channels = 14;
    const mockData = new Float32Array(channels * anchors);

    // Anchor 0: box cx=320, cy=320, w=100, h=100 (norm: 0.5, 0.5, 0.156, 0.156)
    mockData[0 * anchors + 0] = 320;
    mockData[1 * anchors + 0] = 320;
    mockData[2 * anchors + 0] = 100;
    mockData[3 * anchors + 0] = 100;
    mockData[4 * anchors + 0] = 0.92; // AND class score

    const tensor = new ort.Tensor('float32', mockData, [1, channels, anchors]);
    const parsed = parseYoloOutput(tensor, 1000, 800, 0.5);

    expect(parsed.length).toBe(1);
    expect(parsed[0].nodeType).toBe('andGate');
    expect(parsed[0].confidence).toBeCloseTo(0.92);
  });
});
