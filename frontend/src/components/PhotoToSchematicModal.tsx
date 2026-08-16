/**
 * @file PhotoToSchematicModal.tsx
 * @description Snap-to-Simulate Camera & Photo Upload Modal.
 * Integrates client-side WASM YOLO circuit vision inference, interactive confidence
 * threshold filtering, bounding-box overlay canvas rendering, and one-click conversion
 * to a live DigiSim schematic canvas.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Edge, Node } from 'reactflow';
import { generateNetlistFromDetections } from '../logic/vision/netlistGenerator';
import { getDetector, YoloDetection } from '../logic/vision/yoloDetector';
import type { NodeData } from '../types';
import './PhotoToSchematicModal.css';

export interface PhotoToSchematicModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConvert: (nodes: Node<NodeData>[], edges: Edge[]) => void;
}

export const PhotoToSchematicModal: React.FC<PhotoToSchematicModalProps> = ({
  isOpen,
  onClose,
  onConvert,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'camera'>('upload');
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.50);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [allDetections, setAllDetections] = useState<YoloDetection[]>([]);
  const [filteredDetections, setFilteredDetections] = useState<YoloDetection[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isDragActive, setIsDragActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Stop active webcam stream
  const stopWebcam = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  // Start camera stream when tab switches to camera
  useEffect(() => {
    if (isOpen && activeTab === 'camera' && !capturedImage) {
      setCameraError(null);
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices
          .getUserMedia({ video: { facingMode: 'environment' } })
          .then((stream) => {
            streamRef.current = stream;
            if (videoRef.current) {
              videoRef.current.srcObject = stream;
            }
          })
          .catch((err) => {
            console.warn('Webcam permission or access error:', err);
            setCameraError('Camera access denied or unavailable.');
          });
      } else {
        setCameraError('Webcam API is not supported in this browser.');
      }
    } else {
      stopWebcam();
    }
    return () => {
      stopWebcam();
    };
  }, [isOpen, activeTab, capturedImage, stopWebcam]);

  // Run YOLO detection on newly loaded image
  const processImage = useCallback(
    async (imageSrc: string) => {
      setIsProcessing(true);
      setCapturedImage(imageSrc);

      try {
        const detector = await getDetector();
        // Detect with a low base threshold to capture all potential detections, then filter dynamically
        const detections = await detector.detect(imageSrc, 0.05);
        setAllDetections(detections);
      } catch (err) {
        console.error('YOLO detection failed:', err);
        setAllDetections([]);
      } finally {
        setIsProcessing(false);
      }
    },
    []
  );

  // Filter detections when threshold slider changes
  useEffect(() => {
    const filtered = allDetections.filter((det) => det.confidence >= confidenceThreshold);
    setFilteredDetections(filtered);
  }, [allDetections, confidenceThreshold]);

  // Render bounding box canvas overlay
  useEffect(() => {
    if (!capturedImage || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.src = capturedImage;
    img.onload = () => {
      canvas.width = img.width || 640;
      canvas.height = img.height || 640;

      // Draw original image
      ctx.drawImage(img, 0, 0);

      // Draw bounding boxes for filtered detections
      filteredDetections.forEach((det) => {
        const { x1, y1, width, height, className, confidence } = det;

        // Box stroke
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = Math.max(2, Math.round(canvas.width / 300));
        ctx.strokeRect(x1, y1, width, height);

        // Label background badge
        const confPercent = Math.round(confidence * 100);
        const labelText = `${className} (${confPercent}%)`;
        ctx.font = 'bold 14px monospace';
        const textMetrics = ctx.measureText(labelText);
        const badgeWidth = textMetrics.width + 12;
        const badgeHeight = 22;

        ctx.fillStyle = 'rgba(0, 240, 255, 0.85)';
        ctx.fillRect(x1, Math.max(0, y1 - badgeHeight), badgeWidth, badgeHeight);

        // Label text
        ctx.fillStyle = '#0a0f19';
        ctx.fillText(labelText, x1 + 6, Math.max(15, y1 - 6));
      });
    };
  }, [capturedImage, filteredDetections]);

  // Handle file upload selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          processImage(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = () => {
    setIsDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          processImage(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Webcam snap frame
  const handleCaptureWebcam = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg');
      stopWebcam();
      processImage(dataUrl);
    }
  };

  // Reset captured image and return to camera/upload picker
  const handleRetake = () => {
    setCapturedImage(null);
    setAllDetections([]);
    setFilteredDetections([]);
  };

  // Convert detections to DigiSim schematic and close modal
  const handleConvert = () => {
    const { nodes, edges } = generateNetlistFromDetections(filteredDetections);
    onConvert(nodes, edges);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="photo-to-schematic-backdrop" role="dialog" aria-label="Snap-to-Simulate AI Modal">
      <div className="photo-to-schematic-modal">
        <div className="photo-to-schematic-header">
          <div className="photo-to-schematic-title">
            <span>📷</span>
            <span>Snap-to-Simulate YOLO Circuit Vision</span>
          </div>
          <button className="photo-to-schematic-close" onClick={onClose} aria-label="Close modal">
            &times;
          </button>
        </div>

        <div className="photo-to-schematic-body">
          {!capturedImage && (
            <>
              <div className="photo-to-schematic-tabs">
                <button
                  className={`photo-tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
                  onClick={() => setActiveTab('upload')}
                >
                  📁 Upload Circuit Photo
                </button>
                <button
                  className={`photo-tab-btn ${activeTab === 'camera' ? 'active' : ''}`}
                  onClick={() => setActiveTab('camera')}
                >
                  📷 Webcam Live Capture
                </button>
              </div>

              {activeTab === 'upload' ? (
                <div
                  className={`dropzone-container ${isDragActive ? 'active' : ''}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept="image/*"
                    style={{ display: 'none' }}
                  />
                  <div className="dropzone-icon">🖼️</div>
                  <div className="dropzone-text">Drop your circuit schematic photo here or click to browse</div>
                  <div className="dropzone-subtext">Supports PNG, JPG, JPEG, WEBP</div>
                </div>
              ) : (
                <div className="webcam-container">
                  {cameraError ? (
                    <div style={{ color: '#f85149', padding: '2rem', textAlign: 'center' }}>
                      {cameraError}
                    </div>
                  ) : (
                    <>
                      <video ref={videoRef} autoPlay playsInline muted className="webcam-video" />
                      <button className="capture-btn" onClick={handleCaptureWebcam}>
                        📸 Snap Circuit Photo
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {capturedImage && (
            <>
              <div className="preview-container">
                <canvas ref={canvasRef} className="preview-canvas" />
              </div>

              <div className="threshold-control">
                <span className="threshold-label">Confidence Threshold:</span>
                <div className="threshold-slider-group">
                  <input
                    type="range"
                    min="0.05"
                    max="0.95"
                    step="0.05"
                    value={confidenceThreshold}
                    onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                    className="threshold-slider"
                  />
                  <span className="threshold-value">{Math.round(confidenceThreshold * 100)}%</span>
                </div>
                <button
                  onClick={handleRetake}
                  style={{
                    background: '#21262d',
                    color: '#c9d1d9',
                    border: '1px solid #30363d',
                    padding: '0.4rem 0.8rem',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  🔄 Retake
                </button>
              </div>
            </>
          )}
        </div>

        <div className="photo-to-schematic-footer">
          <div className="detection-count">
            {isProcessing ? (
              <span>⚡ Processing ONNX YOLO inference...</span>
            ) : capturedImage ? (
              <span>
                Found <strong>{filteredDetections.length}</strong> component(s)
              </span>
            ) : (
              <span>Select or capture a photo to begin vision inference</span>
            )}
          </div>

          <button
            className="convert-action-btn"
            disabled={!capturedImage || isProcessing || filteredDetections.length === 0}
            onClick={handleConvert}
          >
            ⚡ Convert to Live DigiSim Schematic
          </button>
        </div>
      </div>
    </div>
  );
};
