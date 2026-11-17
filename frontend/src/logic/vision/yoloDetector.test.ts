import * as ort from 'onnxruntime-web';
import { applyNMS, decodeYoloOutput, YoloCircuitDetector, YOLO_CLASS_MAP } from './yoloDetector';
import type { YoloDetection } from './yoloDetector';

describe('yoloDetector', () => {
  it('maps class names to DigiSim node types correctly', () => {
    expect(YOLO_CLASS_MAP['AND']).toBe('andGate');
    expect(YOLO_CLASS_MAP['OR']).toBe('orGate');
    expect(YOLO_CLASS_MAP['SWITCH']).toBe('input');
    expect(YOLO_CLASS_MAP['LED']).toBe('output');
  });

  it('filters overlapping boxes using NMS', () => {
    const detections: YoloDetection[] = [
      {
        className: 'AND',
        nodeType: 'andGate',
        confidence: 0.95,
        x: 100,
        y: 100,
        width: 50,
        height: 50,
        x1: 75,
        y1: 75,
        x2: 125,
        y2: 125,
      },
      {
        className: 'AND',
        nodeType: 'andGate',
        confidence: 0.80,
        x: 102,
        y: 102,
        width: 50,
        height: 50,
        x1: 77,
        y1: 77,
        x2: 127,
        y2: 127,
      },
      {
        className: 'OR',
        nodeType: 'orGate',
        confidence: 0.92,
        x: 300,
        y: 300,
        width: 50,
        height: 50,
        x1: 275,
        y1: 275,
        x2: 325,
        y2: 325,
      },
    ];

    const nmsResults = applyNMS(detections, 0.45);
    expect(nmsResults.length).toBe(2);
    expect(nmsResults[0].confidence).toBe(0.95);
    expect(nmsResults[1].confidence).toBe(0.92);
  });

  it('runs detection and returns detections cleanly in fallback mode', async () => {
    const detector = new YoloCircuitDetector('/models/nonexistent.onnx');
    await detector.init();

    const detections = await detector.detect('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 0.50);
    expect(Array.isArray(detections)).toBe(true);
    expect(detections.length).toBeGreaterThan(0);
    expect(detections[0]).toHaveProperty('confidence');
    expect(detections[0]).toHaveProperty('nodeType');
  });

  describe('decodeYoloOutput class tables', () => {
    /**
     * Build a [1, 4 + numClasses, 1] output tensor with a single box scoring 0.9 for one class.
     * @param numClasses - Number of classes in the fake model
     * @param classIdx - Class id that scores highest
     * @returns The ONNX tensor
     */
    function singleBoxTensor(numClasses: number, classIdx: number): ort.Tensor {
      const data = new Float32Array(4 + numClasses);
      data.set([320, 320, 100, 80], 0);
      data[4 + classIdx] = 0.9;
      return new ort.Tensor('float32', data, [1, 4 + numClasses, 1]);
    }

    it('decodes a legacy 12-class model with the gate-era class order', () => {
      const legacy = ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR', 'SWITCH', 'INPUT', 'OUTPUT', 'LED', 'JUNCTION'];
      legacy.forEach((name, idx) => {
        const [det] = decodeYoloOutput(singleBoxTensor(12, idx), 640, 640, 0.5);
        expect(det.className).toBe(name);
        expect(det.nodeType).toBe(YOLO_CLASS_MAP[name]);
      });
    });

    it('decodes a 20-class model with the canonical class order', () => {
      const [nmos] = decodeYoloOutput(singleBoxTensor(20, 0), 640, 640, 0.5);
      expect(nmos.className).toBe('NMOS');
      expect(nmos.nodeType).toBe('nmos');
      const [and] = decodeYoloOutput(singleBoxTensor(20, 7), 640, 640, 0.5);
      expect(and.className).toBe('AND');
      expect(and.nodeType).toBe('andGate');
    });

    it('computes box corners from the box center and size', () => {
      const [det] = decodeYoloOutput(singleBoxTensor(20, 0), 640, 640, 0.5);
      expect([det.x1, det.y1, det.x2, det.y2]).toEqual([270, 280, 370, 360]);
    });
  });
});
