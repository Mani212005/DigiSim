/**
 * @file NetlistPanel.tsx
 * @description Right-hand sidebar that shows a live netlist (component + connection
 * list) for every runnable circuit on the canvas. Collapsible like the left sidebar;
 * each circuit section has a Copy button for handing the netlist to another tool.
 */

import React, { useMemo } from 'react';
import { buildNetlist, findCircuits } from '../logic/circuitAnalysis';
import type { NetlistPanelProps } from '../types';
import './NetlistPanel.css';

/**
 * Netlist sidebar.
 * @param props - Live nodes/edges, open state, toggle, and export/import handlers
 * @returns Rendered netlist panel
 */
function NetlistPanel({
  nodes,
  edges,
  open,
  onToggle,
  onExport,
  onImportOpen,
}: NetlistPanelProps): React.ReactElement {
  const netlists = useMemo(() => {
    const circuits = findCircuits(nodes, edges);
    return circuits.map((c) => buildNetlist(c, nodes, edges));
  }, [nodes, edges]);

  if (!open) {
    return (
      <button
        className="netlist-reveal-btn"
        aria-label="Show netlist"
        title="Show netlist"
        onClick={onToggle}
      >
        ⌗
      </button>
    );
  }

  return (
    <div className="netlist-panel">
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
            aria-label="Hide netlist"
            title="Hide netlist"
            onClick={onToggle}
          >
            »
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
  );
}

export default NetlistPanel;
