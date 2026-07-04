/**
 * @file TerminalPanel.tsx
 * @description VS-Code-style terminal docked at the bottom of the canvas, toggled with
 * Ctrl/Cmd+J. Shows per-circuit truth tables and JSON schema in tabs. Each runnable
 * circuit (connected component with inputs and outputs) gets two auto tabs; users can
 * add configurable tabs via "+". All content derives live from the current nodes/edges.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildCircuitGraph,
  findCircuits,
  generateTruthTable,
  MAX_TRUTH_TABLE_INPUTS,
} from '../logic/circuitAnalysis';
import type {
  Circuit,
  JsonViewMode,
  TerminalPanelProps,
  TerminalTab,
  TruthTable,
} from '../types';
import './TerminalPanel.css';

/** Render a truth table as a monospace grid. */
function TruthTableView({ table }: { table: TruthTable }): React.ReactElement {
  if (table.inputs.length === 0 || table.outputs.length === 0) {
    return <div className="terminal-empty">Connect inputs and outputs to see a truth table.</div>;
  }
  if (table.truncated) {
    return (
      <div className="terminal-empty">
        {table.inputs.length} inputs is too many to enumerate (limit{' '}
        {MAX_TRUTH_TABLE_INPUTS}). Reduce inputs to view the table.
      </div>
    );
  }
  return (
    <table className="truth-table">
      <thead>
        <tr>
          {table.inputs.map((c) => (
            <th key={c.id} className="tt-in">{c.label}</th>
          ))}
          {table.outputs.map((c) => (
            <th key={c.id} className="tt-out">{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, i) => (
          <tr key={i}>
            {row.inputs.map((v, j) => (
              <td key={j} className={v ? 'v1' : 'v0'}>{v}</td>
            ))}
            {row.outputs.map((v, j) => (
              <td key={j} className={`tt-out ${v ? 'v1' : 'v0'}`}>{v}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Render a circuit's JSON with a Clean/Raw toggle. */
function JsonView({
  circuit,
  nodes,
  edges,
}: {
  circuit: Circuit;
  nodes: TerminalPanelProps['nodes'];
  edges: TerminalPanelProps['edges'];
}): React.ReactElement {
  const [mode, setMode] = useState<JsonViewMode>('clean');
  const graph = useMemo(() => buildCircuitGraph(circuit, nodes, edges), [circuit, nodes, edges]);
  const text = JSON.stringify(mode === 'clean' ? graph.clean : graph.raw, null, 2);

  return (
    <div className="json-view">
      <div className="json-view__bar">
        <div className="json-toggle">
          {(['clean', 'raw'] as JsonViewMode[]).map((m) => (
            <button
              key={m}
              className={`json-toggle__btn${mode === m ? ' json-toggle__btn--active' : ''}`}
              onClick={() => setMode(m)}
            >
              {m === 'clean' ? 'Clean' : 'Raw'}
            </button>
          ))}
        </div>
        <button className="terminal-copy" onClick={() => navigator.clipboard?.writeText(text)}>
          Copy
        </button>
      </div>
      <pre className="json-pre">{text}</pre>
    </div>
  );
}

/** Dropdown-driven tab that lets the user pick a circuit + view. */
function ConfigView({
  circuits,
  onChoose,
}: {
  circuits: Circuit[];
  onChoose: (circuitId: string, kind: 'truthTable' | 'json') => void;
}): React.ReactElement {
  const [circuitId, setCircuitId] = useState('');
  const [kind, setKind] = useState<'truthTable' | 'json'>('truthTable');

  return (
    <div className="terminal-config">
      <h4>New view</h4>
      {circuits.length === 0 ? (
        <p className="terminal-empty">No runnable circuits yet — connect inputs and outputs.</p>
      ) : (
        <>
          <label>
            Circuit
            <select value={circuitId} onChange={(e) => setCircuitId(e.target.value)}>
              <option value="">Select…</option>
              {circuits.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            View
            <select value={kind} onChange={(e) => setKind(e.target.value as 'truthTable' | 'json')}>
              <option value="truthTable">Truth Table</option>
              <option value="json">JSON Schema</option>
            </select>
          </label>
          <button
            className="terminal-config__go"
            disabled={!circuitId}
            onClick={() => circuitId && onChoose(circuitId, kind)}
          >
            Open
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Bottom terminal panel with auto + user tabs.
 * @param props - Live nodes/edges, open state, and close handler
 * @returns Rendered terminal panel, or null when closed
 */
function TerminalPanel({ nodes, edges, open, onClose }: TerminalPanelProps): React.ReactElement | null {
  const circuits = useMemo(() => findCircuits(nodes, edges), [nodes, edges]);
  const circuitById = useMemo(() => new Map(circuits.map((c) => [c.id, c])), [circuits]);

  // Auto tabs: two per runnable circuit, always reflecting current circuits.
  const autoTabs = useMemo<TerminalTab[]>(
    () =>
      circuits.flatMap((c) => [
        { id: `auto-${c.id}-truth`, title: `${c.name} · Truth`, kind: 'truthTable', circuitId: c.id, closable: false },
        { id: `auto-${c.id}-json`, title: `${c.name} · JSON`, kind: 'json', circuitId: c.id, closable: false },
      ]),
    [circuits]
  );

  const [userTabs, setUserTabs] = useState<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [height, setHeight] = useState(320);
  const userSeq = useRef(0);

  const tabs = useMemo(() => [...autoTabs, ...userTabs], [autoTabs, userTabs]);

  // Keep the active tab valid as circuits change.
  useEffect(() => {
    if (tabs.length === 0) {
      if (activeId !== null) setActiveId(null);
    } else if (!activeId || !tabs.some((t) => t.id === activeId)) {
      setActiveId(tabs[0].id);
    }
  }, [tabs, activeId]);

  const addConfigTab = useCallback(() => {
    const id = `user-${(userSeq.current += 1)}`;
    setUserTabs((prev) => [
      ...prev,
      { id, title: 'New tab', kind: 'config', circuitId: null, closable: true },
    ]);
    setActiveId(id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setUserTabs((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const configureTab = useCallback(
    (id: string, circuitId: string, kind: 'truthTable' | 'json') => {
      const circuit = circuitById.get(circuitId);
      setUserTabs((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                kind,
                circuitId,
                title: `${circuit?.name ?? 'Circuit'} · ${kind === 'truthTable' ? 'Truth' : 'JSON'}`,
              }
            : t
        )
      );
    },
    [circuitById]
  );

  // Drag the top edge to resize the panel height.
  const onResizeStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startH = height;
    const onMove = (e: MouseEvent): void => {
      const next = Math.min(Math.max(startH + (startY - e.clientY), 140), window.innerHeight - 160);
      setHeight(next);
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [height]);

  if (!open) return null;

  const active = tabs.find((t) => t.id === activeId) ?? null;
  const activeCircuit = active?.circuitId ? circuitById.get(active.circuitId) ?? null : null;

  return (
    <div className="terminal-panel" style={{ height }}>
      <div className="terminal-resize" onMouseDown={onResizeStart} aria-hidden="true" />
      <div className="terminal-tabbar">
        <div className="terminal-tabs">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`terminal-tab${tab.id === activeId ? ' terminal-tab--active' : ''}`}
              onClick={() => setActiveId(tab.id)}
            >
              <span className="terminal-tab__title">{tab.title}</span>
              {tab.closable && (
                <button
                  className="terminal-tab__close"
                  aria-label={`Close ${tab.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button className="terminal-tab-add" aria-label="New tab" title="New tab" onClick={addConfigTab}>
            +
          </button>
        </div>
        <button className="terminal-close" aria-label="Close terminal (Ctrl+J)" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="terminal-body">
        {tabs.length === 0 && (
          <div className="terminal-empty">
            No runnable circuits. Add input and output nodes and connect them.
          </div>
        )}
        {active?.kind === 'config' && (
          <ConfigView circuits={circuits} onChoose={(cid, kind) => configureTab(active.id, cid, kind)} />
        )}
        {active?.kind === 'truthTable' &&
          (activeCircuit ? (
            <TruthTableView table={generateTruthTable(activeCircuit, nodes, edges)} />
          ) : (
            <div className="terminal-empty">This circuit no longer exists.</div>
          ))}
        {active?.kind === 'json' &&
          (activeCircuit ? (
            <JsonView circuit={activeCircuit} nodes={nodes} edges={edges} />
          ) : (
            <div className="terminal-empty">This circuit no longer exists.</div>
          ))}
      </div>
    </div>
  );
}

export default TerminalPanel;
