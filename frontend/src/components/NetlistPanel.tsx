/**
 * @file NetlistPanel.tsx
 * @description Right-hand sidebar that shows a live netlist (component + connection
 * list) for every runnable circuit on the canvas, plus Export/Import for the
 * canonical JSON netlist. Collapsible like the left toolbox: hovering the ⌗
 * reveal button peeks the panel as an overlay, clicking pins it open, and the
 * header button closes it again. The left edge is drag-resizable.
 */

import React, { useMemo, useRef, useState } from 'react';
import { buildNetlist, findCircuits } from '../logic/circuitAnalysis';
import type { NetlistPanelProps } from '../types';
import './NetlistPanel.css';

/**
 * Netlist sidebar.
 * @param props - Live nodes/edges, pinned-open state, toggle, and export/import handlers
 * @returns Rendered netlist panel (reveal button, overlay peek, or pinned column)
 */
function NetlistPanel({
  nodes,
  edges,
  open,
  onToggle,
  onExport,
  onImportOpen,
}: NetlistPanelProps): React.ReactElement {
  const [peek, setPeek] = useState(false);
  const [width, setWidth] = useState(300);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const netlists = useMemo(() => {
    const circuits = findCircuits(nodes, edges);
    return circuits.map((c) => buildNetlist(c, nodes, edges));
  }, [nodes, edges]);

  /** Keep the hover peek open (cancel any scheduled close). */
  const holdPeek = (): void => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    setPeek(true);
  };

  /** Schedule the hover peek to close shortly after mouse-out. */
  const releasePeek = (): void => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(false), 260);
  };

  /**
   * Drag the panel's left edge to resize it.
   * @param event - Mouse-down on the resize handle
   */
  const startResize = (event: React.MouseEvent): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (move: MouseEvent): void =>
      setWidth(Math.min(520, Math.max(220, startWidth - (move.clientX - startX))));
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const visible = open || peek;

  return (
    <>
      {!open && (
        <button
          className="netlist-reveal-btn"
          aria-label="Show netlist"
          title="Netlist — hover to peek, click to pin"
          onMouseEnter={holdPeek}
          onMouseLeave={releasePeek}
          onClick={() => {
            setPeek(false);
            onToggle();
          }}
        >
          ⌗
        </button>
      )}
      {open && (
        <div className="panel-resizer" aria-hidden="true" onMouseDown={startResize} />
      )}
      {visible && (
        <div
          className={`netlist-panel${!open ? ' netlist-panel--peek' : ''}`}
          style={{ '--netlist-w': `${width}px` } as React.CSSProperties}
          onMouseEnter={!open ? holdPeek : undefined}
          onMouseLeave={!open ? releasePeek : undefined}
        >
          <div className="netlist-head">
            <span className="netlist-head__title">Netlist</span>
            <div className="netlist-head__actions">
              <button
                className="netlist-io-btn"
                title="Download the canvas as a JSON netlist"
                onClick={onExport}
              >
                ⬇ Export
              </button>
              <button
                className="netlist-io-btn"
                title="Import a JSON netlist onto the canvas"
                onClick={onImportOpen}
              >
                ⬆ Import
              </button>
              <button
                className="netlist-collapse-btn"
                aria-label={open ? 'Hide netlist' : 'Pin netlist open'}
                title={open ? 'Close — hover ⌗ to peek' : 'Pin open'}
                onClick={() => {
                  setPeek(false);
                  onToggle();
                }}
              >
                {open ? '»' : '⊙'}
              </button>
            </div>
          </div>

          <div className="netlist-body">
            {netlists.length === 0 ? (
              <p className="netlist-empty">
                No runnable circuits yet. Add input and output nodes and connect them to
                generate a netlist.
              </p>
            ) : (
              netlists.map((nl) => (
                <section key={nl.circuitId} className="netlist-section">
                  <div className="netlist-section__head">
                    <span className="netlist-section__name">{nl.name}</span>
                    <button
                      className="netlist-copy"
                      aria-label={`Copy ${nl.name} netlist`}
                      onClick={() => navigator.clipboard?.writeText(nl.text)}
                    >
                      Copy
                    </button>
                  </div>
                  <pre className="netlist-pre">{nl.text}</pre>
                </section>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default NetlistPanel;
