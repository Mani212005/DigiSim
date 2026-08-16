/**
 * @file PhotoToSchematicModal.tsx
 * @description "Snap-to-Simulate" modal with live webcam capture, drag & drop photo upload,
 * real-time WASM YOLO circuit vision bounding box overlays, confidence threshold slider,
 * and one-click conversion to live DigiSim schematics.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { DigiEdge, DigiNode } from '../types';
import {
  detectCircuitComponents,
  getOrLoadYoloSession,
  type YoloDetection,
} from '../logic/vision/yoloDetector';
import { generateNetlistFromDetections } from '../logic/vision/netlistGenerator';
import './PhotoToSchematicModal.css';

export interface PhotoToSchematicModalProps {
  onClose: () => void;
  onApplySchematic: (blueprint: { nodes: DigiNode[]; edges: DigiEdge[] }) => void;
}

const BOX_COLORS: Record<string, string> = {
  andGate: '#00f3ff',
  orGate: '#00ff66',
  notGate: '#ffaa00',
  nandGate: '#ff0055',
  norGate: '#aa00ff',
  xorGate: '#0099ff',
  xnorGate: '#ff6600',
  input: '#38bdf8',
  output: '#f43f5e',
  junction: '#a855f7',
};

export const PhotoToSchematicModal: React.FC<PhotoToSchematicModalProps> = ({
  onClose,
  onApplySchematic,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'camera'>('upload');
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.5);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [isModelLoading, setIsModelLoading] = useState<boolean>(false);
  const [modelReady, setModelReady] = useState<boolean>(false);
  const [rawDetections, setRawDetections] = useState<YoloDetection[]>([]);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Pre-load YOLO model session on modal mount
  useEffect(() => {
    let mounted = true;
    setIsModelLoading(true);
    getOrLoadYoloSession()
      .then((session) => {
        if (mounted) {
          setModelReady(!!session);
          setIsModelLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setModelReady(false);
          setIsModelLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Stop camera stream when tab changes or unmounts
  const stopCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    }
  }, [cameraStream]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Start camera feed when camera tab is selected
  useEffect(() => {
    if (activeTab === 'camera') {
      setCameraError(null);
      navigator.mediaDevices
        ?.getUserMedia({ video: { facingMode: 'environment' } })
        .then((stream) => {
          setCameraStream(stream);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        })
        .catch((err) => {
          console.warn('Webcam access error:', err);
          setCameraError('Unable to access camera. Please check browser permissions.');
        });
    } else {
      stopCamera();
    }
  }, [activeTab, stopCamera]);

  // Filter raw detections by user confidence slider
  const activeDetections = rawDetections.filter(
    (d) => d.confidence >= confidenceThreshold
  );

  // Redraw canvas with photo and bounding box overlays
  const drawCanvasOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.complete) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = img.naturalWidth || 800;
    canvas.height = img.naturalHeight || 600;

    // Draw background image
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Draw bounding boxes for active detections
    activeDetections.forEach((det) => {
      const color = BOX_COLORS[det.nodeType] || '#00f3ff';

      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(3, Math.round(canvas.width / 300));
      ctx.strokeRect(det.x1, det.y1, det.width, det.height);

      // Label background pill
      const labelText = `${det.label} ${(det.confidence * 100).toFixed(0)}%`;
      ctx.font = `bold ${Math.max(14, Math.round(canvas.width / 50))}px sans-serif`;
      const textMetrics = ctx.measureText(labelText);
      const textWidth = textMetrics.width;
      const textHeight = Math.max(18, Math.round(canvas.width / 45));

      const pillX = Math.max(0, det.x1);
      const pillY = Math.max(textHeight, det.y1 - 6);

      ctx.fillStyle = color;
      ctx.fillRect(pillX, pillY - textHeight, textWidth + 12, textHeight + 4);

      ctx.fillStyle = '#0f172a';
      ctx.fillText(labelText, pillX + 6, pillY - 4);
    });
  }, [activeDetections]);

  useEffect(() => {
    drawCanvasOverlay();
  }, [drawCanvasOverlay]);

  // Run vision detection pipeline on selected image
  const processImageForDetection = useCallback(
    async (src: string) => {
      setImageSrc(src);
      setIsDetecting(true);
      setRawDetections([]);

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = src;

      img.onload = async () => {
        imgRef.current = img;
        try {
          // Detect with low baseline confidence threshold to collect all candidate boxes
          const result = await detectCircuitComponents(img, 0.1);
          setRawDetections(result.detections);
        } catch (err) {
          console.error('YOLO Circuit Vision Detection Error:', err);
        } finally {
          setIsDetecting(false);
        }
      };
    },
    []
  );

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          processImageForDetection(evt.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          processImageForDetection(evt.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const captureCameraFrame = () => {
    if (videoRef.current) {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg');
        processImageForDetection(dataUrl);
      }
    }
  };

  const handleConvertSchematic = () => {
    const img = imgRef.current;
    const w = img?.naturalWidth || 1000;
    const h = img?.naturalHeight || 800;

    const blueprint = generateNetlistFromDetections(activeDetections, w, h);
    onApplySchematic(blueprint);
    onClose();
  };

  // Group detected counts for summary badge
  const detSummary = activeDetections.reduce((acc, d) => {
    acc[d.label] = (acc[d.label] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="pts-modal-overlay" onClick={onClose}>
      <div className="pts-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="pts-modal-header">
          <div className="pts-modal-title">
            <span>📷 "Snap-to-Simulate" YOLO Circuit Vision</span>
            <span className="pts-badge">
              {isModelLoading
                ? '⏳ Loading WASM Engine...'
                : modelReady
                ? '⚡ WASM Engine Ready ($0 Azure)'
                : 'Client WASM Inference'}
            </span>
          </div>
          <button className="pts-close-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        {/* Tab Selection */}
        <div className="pts-modal-tabs">
          <button
            className={`pts-tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('upload');
              stopCamera();
            }}
          >
            📁 Photo Upload & Drag/Drop
          </button>
          <button
            className={`pts-tab-btn ${activeTab === 'camera' ? 'active' : ''}`}
            onClick={() => setActiveTab('camera')}
          >
            📹 Live Webcam Capture
          </button>
        </div>

        {/* Modal Body */}
        <div className="pts-modal-body">
          {/* Main Display / Preview Area */}
          <div
            className="pts-view-area"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            {imageSrc ? (
              <>
                <canvas ref={canvasRef} className="pts-canvas-overlay" />
                <img
                  ref={imgRef}
                  src={imageSrc}
                  alt="Source Circuit"
                  style={{ display: 'none' }}
                  onLoad={drawCanvasOverlay}
                />
              </>
            ) : activeTab === 'camera' ? (
              cameraError ? (
                <div style={{ color: '#f43f5e', textAlign: 'center', padding: '2rem' }}>
                  ⚠️ {cameraError}
                </div>
              ) : (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="pts-webcam-feed"
                />
              )
            ) : (
              <div
                className="pts-drop-zone"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="pts-drop-icon">📷</div>
                <div className="pts-drop-title">
                  Drop circuit photo here or click to browse
                </div>
                <div className="pts-drop-sub">
                  Supports JPG, PNG, WEBP schematic photos & breadboard captures
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                />
              </div>
            )}
          </div>

          {/* Action / Capture Controls for Camera */}
          {activeTab === 'camera' && !imageSrc && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button
                className="pts-btn-primary"
                onClick={captureCameraFrame}
                disabled={!cameraStream}
              >
                📸 Capture Photo for AI Analysis
              </button>
            </div>
          )}

          {/* Controls & Confidence Slider when Image is Present */}
          {imageSrc && (
            <div className="pts-controls-panel">
              <div className="pts-slider-row">
                <label className="pts-slider-label">
                  ⚡ Detection Confidence Threshold:
                  <span className="pts-slider-value">
                    {(confidenceThreshold * 100).toFixed(0)}%
                  </span>
                </label>
                <input
                  type="range"
                  min="0.10"
                  max="0.95"
                  step="0.05"
                  value={confidenceThreshold}
                  onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                  className="pts-slider"
                />
              </div>

              {/* Detections Summary Pills */}
              <div className="pts-detections-summary">
                <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>
                  Detected Parts ({activeDetections.length}):
                </span>
                {Object.keys(detSummary).length > 0 ? (
                  Object.entries(detSummary).map(([label, count]) => (
                    <span key={label} className="pts-det-pill">
                      {label} <span className="pts-det-count">×{count}</span>
                    </span>
                  ))
                ) : (
                  <span style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic' }}>
                    No components detected above {(confidenceThreshold * 100).toFixed(0)}% confidence
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="pts-modal-footer">
          <div>
            {imageSrc && (
              <button
                className="pts-btn-secondary"
                onClick={() => {
                  setImageSrc(null);
                  setRawDetections([]);
                }}
              >
                🔄 Choose / Retake Photo
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button className="pts-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="pts-btn-primary"
              onClick={handleConvertSchematic}
              disabled={!imageSrc || isDetecting || activeDetections.length === 0}
            >
              {isDetecting ? (
                <>
                  <span className="pts-spinner" /> Running WASM YOLO...
                </>
              ) : (
                <>⚡ Convert to Live DigiSim Schematic</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PhotoToSchematicModal;
