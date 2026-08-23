import { applyNMS, YoloCircuitDetector, YOLO_CLASS_MAP } from './yoloDetector';
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
});
