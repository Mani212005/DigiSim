/**
 * @file Pcb3DViewer.tsx
 * @description Interactive 3D WebGL / 3D projected multi-layer PCB view component.
 * Renders FR4 substrate board, top and bottom copper traces, vias, silkscreen labels,
 * and 3D component packages (DIP ICs, resistors, capacitors, MOSFETs, LEDs). Supports
 * interactive 3D orbit rotation, zoom, and layer visibility toggles.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { Pcb3DLayerVisibility, Pcb3DViewerProps } from '../../types';
import './Pcb3DViewer.css';

/**
 * 3D PCB multi-layer viewer component.
 *
 * @param props - Schematic nodes, edges, open state, and close callback
 * @returns Rendered 3D PCB Modal/Overlay
 */
export function Pcb3DViewer({
  nodes,
  edges,
  open,
  onClose,
}: Pcb3DViewerProps): React.ReactElement | null {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 3D Orbit Camera state
  const [rotX, setRotX] = useState(0.65);
  const [rotY, setRotY] = useState(-0.45);
  const [zoom, setZoom] = useState(1.1);
  const isDragging = useRef(false);
  const lastMouse = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Layer visibility toggles
  const [layers, setLayers] = useState<Pcb3DLayerVisibility>({
    topCopper: true,
    bottomCopper: true,
    silkscreen: true,
    substrate: true,
    components3D: true,
  });

  useEffect(() => {
    if (!open || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render3D = (): void => {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;

      // 3D Projection transform (Isometric / Perspective matrix)
      const project = (x: number, y: number, z: number): { px: number; py: number; depth: number } => {
        // Center normalized coordinates around origin
        const nx = (x - 300) * 0.8;
        const ny = (y - 200) * 0.8;
        const nz = z * 0.8;

        // Rotation Y (yaw)
        const cosY = Math.cos(rotY);
        const sinY = Math.sin(rotY);
        const x1 = nx * cosY + nz * sinY;
        const z1 = -nx * sinY + nz * cosY;

        // Rotation X (pitch)
        const cosX = Math.cos(rotX);
        const sinX = Math.sin(rotX);
        const y2 = ny * cosX - z1 * sinX;
        const z2 = ny * sinX + z1 * cosX;

        const scale = (350 / (350 + z2)) * zoom;
        return {
          px: cx + x1 * scale,
          py: cy + y2 * scale,
          depth: z2,
        };
      };

      // Sort & Draw Board Substrate (FR4 Slab)
      if (layers.substrate) {
        ctx.fillStyle = '#0f381e'; // FR4 Dark Green
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1.5;

        // Draw 3D Board Extrusion (Bottom and Top planes)
        const bCorners = [
          project(-100, -100, -8),
          project(700, -100, -8),
          project(700, 500, -8),
          project(-100, 500, -8),
        ];

        const tCorners = [
          project(-100, -100, 0),
          project(700, -100, 0),
          project(700, 500, 0),
          project(-100, 500, 0),
        ];

        // Draw Bottom FR4 face
        ctx.beginPath();
        bCorners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.px, c.py) : ctx.lineTo(c.px, c.py)));
        ctx.closePath();
        ctx.fill();

        // Draw Side bevels
        for (let i = 0; i < 4; i++) {
          const next = (i + 1) % 4;
          ctx.fillStyle = '#0a2614';
          ctx.beginPath();
          ctx.moveTo(bCorners[i].px, bCorners[i].py);
          ctx.lineTo(bCorners[next].px, bCorners[next].py);
          ctx.lineTo(tCorners[next].px, tCorners[next].py);
          ctx.lineTo(tCorners[i].px, tCorners[i].py);
          ctx.closePath();
          ctx.fill();
        }

        // Draw Top FR4 face
        ctx.fillStyle = 'rgba(16, 185, 129, 0.4)';
        ctx.beginPath();
        tCorners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.px, c.py) : ctx.lineTo(c.px, c.py)));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // Bottom Copper Layer (Blue/Cyan Traces)
      if (layers.bottomCopper) {
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.8;
        edges.forEach((edge) => {
          const src = nodes.find((n) => n.id === edge.source);
          const tgt = nodes.find((n) => n.id === edge.target);
          if (src && tgt) {
            const p1 = project(src.position.x + 30, src.position.y + 30, -6);
            const p2 = project(tgt.position.x + 30, tgt.position.y + 30, -6);
            ctx.beginPath();
            ctx.moveTo(p1.px, p1.py);
            ctx.lineTo(p2.px, p2.py);
            ctx.stroke();
          }
        });
      }

      // Top Copper Layer (Copper/Red Traces)
      if (layers.topCopper) {
        ctx.strokeStyle = '#f97316'; // Copper Orange
        ctx.lineWidth = 3.5;
        edges.forEach((edge) => {
          const src = nodes.find((n) => n.id === edge.source);
          const tgt = nodes.find((n) => n.id === edge.target);
          if (src && tgt) {
            const p1 = project(src.position.x, src.position.y, 1);
            const p2 = project(tgt.position.x, tgt.position.y, 1);
            ctx.beginPath();
            ctx.moveTo(p1.px, p1.py);
            ctx.lineTo(p2.px, p2.py);
            ctx.stroke();

            // Draw Vias (plated through-holes)
            [p1, p2].forEach((p) => {
              ctx.fillStyle = '#eab308'; // Gold plating
              ctx.beginPath();
              ctx.arc(p.px, p.py, 4 * zoom, 0, Math.PI * 2);
              ctx.fill();
            });
          }
        });
      }

      // 3D Components
      if (layers.components3D) {
        nodes.forEach((node) => {
          const { x, y } = node.position;
          const p = project(x, y, 12);
          const type = node.type ?? '';

          if (['andGate', 'orGate', 'nandGate', 'norGate', 'xorGate', 'xnorGate', 'notGate'].includes(type)) {
            // DIP IC Package
            const pTL = project(x - 25, y - 18, 14);
            const pBR = project(x + 25, y + 18, 14);
            const w = Math.abs(pBR.px - pTL.px);
            const h = Math.abs(pBR.py - pTL.py);

            ctx.fillStyle = '#1e293b'; // Black Plastic IC Body
            ctx.fillRect(pTL.px, pTL.py, w, h);
            ctx.strokeStyle = '#94a3b8';
            ctx.strokeRect(pTL.px, pTL.py, w, h);

            // Silkscreen text label
            if (layers.silkscreen) {
              ctx.fillStyle = '#f8fafc';
              ctx.font = '10px monospace';
              ctx.fillText(node.data.label, pTL.px + 4, pTL.py - 4);
            }
          } else if (type === 'resistor') {
            // Cylindrical Resistor Body
            ctx.fillStyle = '#d97706';
            ctx.beginPath();
            ctx.arc(p.px, p.py, 8 * zoom, 0, Math.PI * 2);
            ctx.fill();
          } else if (type === 'led') {
            // 3D LED Dome
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(p.px, p.py, 9 * zoom, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // Standard Part Block
            ctx.fillStyle = '#475569';
            ctx.fillRect(p.px - 12, p.py - 12, 24, 24);
          }
        });
      }

      animId = requestAnimationFrame(render3D);
    };

    render3D();
    return () => cancelAnimationFrame(animId);
  }, [open, nodes, edges, rotX, rotY, zoom, layers]);

  if (!open) return null;

  const handleMouseDown = (e: React.MouseEvent): void => {
    isDragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent): void => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    setRotY((prev) => prev + dx * 0.008);
    setRotX((prev) => prev + dy * 0.008);
    lastMouse.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = (): void => {
    isDragging.current = false;
  };

  const handleWheel = (e: React.WheelEvent): void => {
    setZoom((prev) => Math.min(2.5, Math.max(0.4, prev - e.deltaY * 0.001)));
  };

  return (
    <div className="pcb3d-modal-overlay glass">
      <div className="pcb3d-modal-container">
        <div className="pcb3d-header">
          <div className="pcb3d-title">
            <span>🧊</span> Interactive 3D PCB Viewer
          </div>
          <div className="pcb3d-controls">
            <button className="btn btn-sm" onClick={() => { setRotX(0.65); setRotY(-0.45); setZoom(1.1); }}>
              Reset View
            </button>
            <button className="pcb3d-close" onClick={onClose} aria-label="Close 3D View">
              ✕
            </button>
          </div>
        </div>

        <div className="pcb3d-body">
          <div className="pcb3d-layer-bar">
            <label className="pcb3d-layer-toggle">
              <input
                type="checkbox"
                checked={layers.topCopper}
                onChange={(e) => setLayers({ ...layers, topCopper: e.target.checked })}
              />
              Top Copper (Orange)
            </label>
            <label className="pcb3d-layer-toggle">
              <input
                type="checkbox"
                checked={layers.bottomCopper}
                onChange={(e) => setLayers({ ...layers, bottomCopper: e.target.checked })}
              />
              Bottom Copper (Cyan)
            </label>
            <label className="pcb3d-layer-toggle">
              <input
                type="checkbox"
                checked={layers.substrate}
                onChange={(e) => setLayers({ ...layers, substrate: e.target.checked })}
              />
              FR4 Substrate
            </label>
            <label className="pcb3d-layer-toggle">
              <input
                type="checkbox"
                checked={layers.components3D}
                onChange={(e) => setLayers({ ...layers, components3D: e.target.checked })}
              />
              3D Packages
            </label>
          </div>

          <canvas
            ref={canvasRef}
            width={900}
            height={550}
            className="pcb3d-canvas"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          />
        </div>
      </div>
    </div>
  );
}

export default Pcb3DViewer;
