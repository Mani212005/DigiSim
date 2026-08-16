/**
 * @file yoloDetector.ts
 * @description Client-side WASM YOLO circuit vision inference engine using onnxruntime-web.
 * Performs zero-cost, local browser inference for schematic and component detection.
 */

import * as ort from 'onnxruntime-web';
import type { CircuitNodeType } from '../../types';

export interface YoloDetection {
  id: string;
  className: string;
  nodeType: CircuitNodeType | 'junction';
  label: string;
  confidence: number;
  /** Center X in original image pixels. */
  x: number;
  /** Center Y in original image pixels. */
  y: number;
  /** Width in original image pixels. */
  width: number;
  /** Height in original image pixels. */
  height: number;
  /** Top-left corner X in original image pixels. */
  x1: number;
  /** Top-left corner Y in original image pixels. */
  y1: number;
  /** Bottom-right corner X in original image pixels. */
  x2: number;
  /** Bottom-right corner Y in original image pixels. */
  y2: number;
}

export const CANONICAL_CLASSES = [
  'AND',
  'OR',
  'NOT',
  'NAND',
  'NOR',
  'XOR',
  'XNOR',
  'INPUT',
  'OUTPUT',
  'JUNCTION',
] as const;

export const CLASS_TO_NODE_TYPE: Record<string, CircuitNodeType | 'junction'> = {
  AND: 'andGate',
  'AND Gate': 'andGate',
  andGate: 'andGate',
  OR: 'orGate',
  'OR Gate': 'orGate',
  orGate: 'orGate',
  NOT: 'notGate',
  'NOT Gate': 'notGate',
  notGate: 'notGate',
  NAND: 'nandGate',
  'NAND Gate': 'nandGate',
  nandGate: 'nandGate',
  NOR: 'norGate',
  'NOR Gate': 'norGate',
  norGate: 'norGate',
  XOR: 'xorGate',
  'XOR Gate': 'xorGate',
  xorGate: 'xorGate',
  XNOR: 'xnorGate',
  'XNOR Gate': 'xnorGate',
  xnorGate: 'xnorGate',
  SWITCH: 'input',
  INPUT: 'input',
  input: 'input',
  OUTPUT: 'output',
  LED: 'output',
  output: 'output',
  JUNCTION: 'junction',
  junction: 'junction',
};

export const CLASS_DISPLAY_LABELS: Record<string, string> = {
  andGate: 'AND Gate',
  orGate: 'OR Gate',
  notGate: 'NOT Gate',
  nandGate: 'NAND Gate',
  norGate: 'NOR Gate',
  xorGate: 'XOR Gate',
  xnorGate: 'XNOR Gate',
  input: 'Input Switch',
  output: 'Output LED',
  junction: 'Pin Junction',
};

let sessionCache: ort.InferenceSession | null = null;
let sessionLoadingPromise: Promise<ort.InferenceSession | null> | null = null;

/**
 * Load or return cached ONNX inference session for client-side WASM.
 */
export async function getOrLoadYoloSession(
  modelUrl: string = '/models/yolo_circuit.onnx'
): Promise<ort.InferenceSession | null> {
  if (sessionCache) return sessionCache;
  if (sessionLoadingPromise) return sessionLoadingPromise;

  sessionLoadingPromise = (async () => {
    try {
      // Configure ONNX Runtime Web WASM options
      ort.env.wasm.numThreads = 1;
      const session = await ort.InferenceSession.create(modelUrl, {
        executionProviders: ['wasm'],
      });
      sessionCache = session;
      return session;
    } catch (err) {
      console.warn('WASM ONNX model loading notice:', err);
      return null;
    } finally {
      sessionLoadingPromise = null;
    }
  })();

  return sessionLoadingPromise;
}

/**
 * Image preprocessing: Resize source image to 640x640 and normalize RGB channels [0, 1].
 */
export function preprocessImage(
  imageSource: CanvasImageSource,
  targetWidth = 640,
  targetHeight = 640
): { tensor: ort.Tensor; originalWidth: number; originalHeight: number } {
  let origW = 640;
  let origH = 640;

  if ('videoWidth' in imageSource && typeof imageSource.videoWidth === 'number') {
    origW = imageSource.videoWidth || 640;
    origH = imageSource.videoHeight || 640;
  } else if ('width' in imageSource && typeof imageSource.width === 'number') {
    origW = (imageSource.width as number) || 640;
    origH = (imageSource.height as number) || 640;
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to obtain 2D canvas context for YOLO image preprocessing');
  }

  ctx.drawImage(imageSource, 0, 0, targetWidth, targetHeight);
  const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const { data } = imageData; // RGBA Uint8ClampedArray

  const float32Data = new Float32Array(3 * targetWidth * targetHeight);
  const channelLength = targetWidth * targetHeight;

  for (let i = 0; i < channelLength; i++) {
    float32Data[i] = data[i * 4] / 255.0; // R
    float32Data[channelLength + i] = data[i * 4 + 1] / 255.0; // G
    float32Data[2 * channelLength + i] = data[i * 4 + 2] / 255.0; // B
  }

  const tensor = new ort.Tensor('float32', float32Data, [1, 3, targetWidth, targetHeight]);
  return { tensor, originalWidth: origW, originalHeight: origH };
}

/**
 * Compute Intersection over Union (IoU) between two bounding boxes.
 */
export function computeIoU(a: YoloDetection, b: YoloDetection): number {
  const interX1 = Math.max(a.x1, b.x1);
  const interY1 = Math.max(a.y1, b.y1);
  const interX2 = Math.min(a.x2, b.x2);
  const interY2 = Math.min(a.y2, b.y2);

  const interWidth = Math.max(0, interX2 - interX1);
  const interHeight = Math.max(0, interY2 - interY1);
  const interArea = interWidth * interHeight;

  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);

  const unionArea = areaA + areaB - interArea;
  if (unionArea <= 0) return 0;
  return interArea / unionArea;
}

/**
 * Apply Non-Maximum Suppression (NMS) to filter overlapping detection boxes.
 */
export function applyNMS(
  detections: YoloDetection[],
  iouThreshold = 0.45
): YoloDetection[] {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const selected: YoloDetection[] = [];

  for (const det of sorted) {
    let keep = true;
    for (const sel of selected) {
      if (computeIoU(det, sel) > iouThreshold) {
        keep = false;
        break;
      }
    }
    if (keep) {
      selected.push(det);
    }
  }

  return selected;
}

/**
 * Post-process YOLO output tensor into filtered detections.
 */
export function parseYoloOutput(
  outputTensor: ort.Tensor,
  imgWidth: number,
  imgHeight: number,
  confidenceThreshold = 0.50,
  iouThreshold = 0.45
): YoloDetection[] {
  const data = outputTensor.data as Float32Array;
  const dims = outputTensor.dims; // e.g. [1, num_channels, 8400]
  const rawDetections: YoloDetection[] = [];

  if (dims.length === 3) {
    const channels = dims[1];
    const anchors = dims[2];

    const numClasses = Math.max(1, channels - 4);

    for (let a = 0; a < anchors; a++) {
      const cxNorm = data[0 * anchors + a] / 640;
      const cyNorm = data[1 * anchors + a] / 640;
      const wNorm = data[2 * anchors + a] / 640;
      const hNorm = data[3 * anchors + a] / 640;

      let maxClassIdx = 0;
      let maxScore = 0;

      for (let c = 0; c < numClasses; c++) {
        const score = data[(4 + c) * anchors + a];
        if (score > maxScore) {
          maxScore = score;
          maxClassIdx = c;
        }
      }

      if (maxScore >= confidenceThreshold) {
        const cx = cxNorm * imgWidth;
        const cy = cyNorm * imgHeight;
        const w = wNorm * imgWidth;
        const h = hNorm * imgHeight;

        const x1 = cx - w / 2;
        const y1 = cy - h / 2;
        const x2 = cx + w / 2;
        const y2 = cy + h / 2;

        const rawClassName = CANONICAL_CLASSES[maxClassIdx % CANONICAL_CLASSES.length] || 'AND';
        const nodeType = CLASS_TO_NODE_TYPE[rawClassName] || 'andGate';

        rawDetections.push({
          id: `det_${rawDetections.length}_${Math.random().toString(36).substring(2, 7)}`,
          className: rawClassName,
          nodeType,
          label: CLASS_DISPLAY_LABELS[nodeType] || rawClassName,
          confidence: maxScore,
          x: cx,
          y: cy,
          width: w,
          height: h,
          x1,
          y1,
          x2,
          y2,
        });
      }
    }
  }

  return applyNMS(rawDetections, iouThreshold);
}

/**
 * Execute end-to-end client-side YOLO detection on an image.
 */
export async function detectCircuitComponents(
  imageSource: CanvasImageSource,
  confidenceThreshold = 0.50,
  modelUrl = '/models/yolo_circuit.onnx'
): Promise<{ detections: YoloDetection[]; imageWidth: number; imageHeight: number }> {
  const { tensor, originalWidth, originalHeight } = preprocessImage(imageSource);
  const session = await getOrLoadYoloSession(modelUrl);

  if (!session) {
    return { detections: [], imageWidth: originalWidth, imageHeight: originalHeight };
  }

  const inputName = session.inputNames[0] || 'images';
  const outputs = await session.run({ [inputName]: tensor });
  const outputName = session.outputNames[0] || 'output0';
  const outputTensor = outputs[outputName];

  if (!outputTensor) {
    return { detections: [], imageWidth: originalWidth, imageHeight: originalHeight };
  }

  const detections = parseYoloOutput(
    outputTensor,
    originalWidth,
    originalHeight,
    confidenceThreshold
  );

  return { detections, imageWidth: originalWidth, imageHeight: originalHeight };
}
