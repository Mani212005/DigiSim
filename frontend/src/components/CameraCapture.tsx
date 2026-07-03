/**
 * @file CameraCapture.tsx
 * @description Full-screen camera modal: streams the device's environment-facing
 * camera via getUserMedia, captures a frame to a canvas, and hands the JPEG blob
 * to the detection flow. Falls back to a capture-enabled file input when no
 * camera exists or permission is denied.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraCaptureProps } from '../types';

/**
 * Camera preview modal with a shutter button.
 * @param props - Capture, close, and fallback callbacks
 * @returns Rendered camera modal
 */
function CameraCapture({ onCapture, onClose, onFallback }: CameraCaptureProps): React.ReactElement {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stopStream = useCallback((): void => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    /** Request the back camera and attach it to the preview element. */
    const start = async (): Promise<void> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        onFallback();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.warn('Camera unavailable, falling back to file input:', err);
        if (!cancelled) onFallback();
      }
    };
    start();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [onFallback, stopStream]);

  /** Draw the current video frame to a canvas and emit it as a JPEG blob. */
  const capture = useCallback((): void => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      setError('Camera is still starting — try again in a second.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setError('Could not access the drawing context — try again.');
      return;
    }
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          stopStream();
          onCapture(blob);
        } else {
          setError('Could not capture the frame — try again.');
        }
      },
      'image/jpeg',
      0.92
    );
  }, [onCapture, stopStream]);

  return (
    <div className="camera-modal" role="dialog" aria-label="Camera capture">
      <video ref={videoRef} autoPlay playsInline muted className="camera-video" />
      {error && <div className="camera-error" role="alert">{error}</div>}
      <div className="camera-controls">
        <button
          className="camera-cancel"
          onClick={() => {
            stopStream();
            onClose();
          }}
        >
          Cancel
        </button>
        <button className="camera-shutter" aria-label="Capture photo" onClick={capture} />
        <span className="camera-hint">Frame the circuit sketch</span>
      </div>
    </div>
  );
}

export default CameraCapture;
