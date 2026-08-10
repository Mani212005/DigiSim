/**
 * @file FalstadFlowOverlay.tsx
 * @description Falstad-style animated green-dot signal and current flow overlay for
 * ReactFlow schematic wires. Driven by real-time SPICE / MNA current vectors. Dots
 * animate smoothly along wire SVG paths with speed proportional to current magnitude
 * and direction matching the electrical current sign.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { FalstadFlowOverlayProps } from '../../types';

interface Particle {
  id: string;
  edgeId: string;
  x: number;
  y: number;
  alpha: number;
}

/**
 * Overlay component rendering animated green-dot current flow on top of ReactFlow wires.
 *
 * @param props - Schematic nodes, edges, and solver outputs
 * @returns SVG overlay containing animated current dots
 */
export function FalstadFlowOverlay({
  nodes,
  edges,
  simOutputs,
}: FalstadFlowOverlayProps): React.ReactElement {
  const [particles, setParticles] = useState<Particle[]>([]);
  const animFrameRef = useRef<number | null>(null);
  const offsetRef = useRef<Record<string, number>>({});

  useEffect(() => {
    // Map current for each edge based on source/target node solver outputs
    const currentByEdge = new Map<string, number>();
    const nodeOutputs = new Map(nodes.map((n) => [n.id, n.data]));

    for (const edge of edges) {
      const srcData = nodeOutputs.get(edge.source);
      const tgtData = nodeOutputs.get(edge.target);
      const srcOut = simOutputs?.get(edge.source);

      let current = srcOut?.current ?? srcData?.current ?? 0;
      if (current === 0 && (srcData?.value === 1 || tgtData?.value === 1)) {
        current = 0.005; // Default digital logic signal flow
      }
      currentByEdge.set(edge.id, current);
    }

    const animate = (): void => {
      const newParticles: Particle[] = [];
      const edgePaths = document.querySelectorAll<SVGPathElement>('.react-flow__edge-path');

      edgePaths.forEach((pathEl) => {
        const parentEdge = pathEl.closest('.react-flow__edge');
        const edgeId = parentEdge?.getAttribute('data-id') || pathEl.getAttribute('id') || '';
        const current = currentByEdge.get(edgeId) ?? 0;

        if (Math.abs(current) < 1e-6) return;

        const pathLength = pathEl.getTotalLength();
        if (pathLength <= 0) return;

        // Speed in px/frame based on current magnitude
        const speed = Math.min(10, Math.max(0.8, Math.abs(current) * 400));
        const direction = current >= 0 ? 1 : -1;

        offsetRef.current[edgeId] =
          ((offsetRef.current[edgeId] ?? 0) + speed * direction) % pathLength;
        let baseOffset = offsetRef.current[edgeId];
        if (baseOffset < 0) baseOffset += pathLength;

        // Space particles every ~24px along the wire
        const particleSpacing = 24;
        const numParticles = Math.floor(pathLength / particleSpacing);

        for (let i = 0; i < numParticles; i++) {
          const dist = (baseOffset + i * particleSpacing) % pathLength;
          try {
            const pt = pathEl.getPointAtLength(dist);
            newParticles.push({
              id: `${edgeId}-${i}`,
              edgeId,
              x: pt.x,
              y: pt.y,
              alpha: Math.min(1, Math.abs(current) * 50 + 0.4),
            });
          } catch {
            /* DOM point retrieval fallback */
          }
        }
      });

      setParticles(newParticles);
      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [nodes, edges, simOutputs]);

  return (
    <svg
      className="falstad-flow-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      <defs>
        <filter id="glow-dot" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {particles.map((p) => (
        <circle
          key={p.id}
          cx={p.x}
          cy={p.y}
          r="3.5"
          fill="#4ade80"
          filter="url(#glow-dot)"
          style={{ opacity: p.alpha }}
        />
      ))}
    </svg>
  );
}

export default FalstadFlowOverlay;
