/**
 * @file App.js
 * @description Root application component — owns all node/edge state and wires together
 * the ReactFlow canvas, logic simulation, and image detection pipeline. Renders the
 * circuit-lab UI: schematic palette sidebar (click or drag to add), signal-aware
 * animated wires, and the vision upload flow.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import SampleImages from './components/SampleImages';
import './components/SampleImages.css';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  ReactFlowProvider,
  SelectionMode,
  addEdge,
  useNodesState,
  useEdgesState,
} from 'reactflow';

import 'reactflow/dist/style.css';
import './App.css';

import SelectionToolbar from './components/SelectionToolbar';
import { useIsTouch } from './hooks/useIsTouch';

import InputNode from './nodes/InputNode';
import OutputNode from './nodes/OutputNode';
import AndGateNode from './nodes/AndGateNode';
import NotGateNode from './nodes/NotGateNode';
import OrGateNode from './nodes/OrGateNode';
import XorGateNode from './nodes/XorGateNode';
import NandGateNode from './nodes/NandGateNode';
import XnorGateNode from './nodes/XnorGateNode';
import NorGateNode from './nodes/NorGateNode';
import { GateGlyph } from './nodes/GateShell';

import { useLogicSimulation } from './hooks/useLogicSimulation';
import { useAuth } from './hooks/useAuth';
import CameraCapture from './components/CameraCapture';
import DetectionReview from './components/DetectionReview';

const initialNodes = [
  { id: '1', position: { x: 0, y: 0 }, data: { label: 'Input A', value: 0 }, type: 'input' },
  { id: '2', position: { x: 0, y: 160 }, data: { label: 'Input B', value: 0 }, type: 'input' },
  { id: '3', position: { x: 260, y: 70 }, data: { label: 'AND Gate', value: 0 }, type: 'andGate' },
  { id: '4', position: { x: 520, y: 78 }, data: { label: 'Output', value: 0 }, type: 'output' },
];

const initialEdges = [
  { id: 'e1-3', source: '1', target: '3', sourceHandle: null, targetHandle: 'a' },
  { id: 'e2-3', source: '2', target: '3', sourceHandle: null, targetHandle: 'b' },
  { id: 'e3-4', source: '3', target: '4' },
];

let id = 5;
const getId = () => `${id++}`;

const sampleImages = [
  'fifth_image.jpg',
  'fifty_image.jpg',
  'first_image.jpg',
  'forty_image.jpg',
  'fortyeight_image.jpg',
];

/** Sidebar palette definition: gate chips rendered with their schematic glyphs. */
const GATE_PALETTE = [
  { type: 'andGate', label: 'AND Gate', glyph: 'and', name: 'AND' },
  { type: 'orGate', label: 'OR Gate', glyph: 'or', name: 'OR' },
  { type: 'notGate', label: 'NOT Gate', glyph: 'not', name: 'NOT' },
  { type: 'nandGate', label: 'NAND Gate', glyph: 'nand', name: 'NAND' },
  { type: 'norGate', label: 'NOR Gate', glyph: 'nor', name: 'NOR' },
  { type: 'xorGate', label: 'XOR Gate', glyph: 'xor', name: 'XOR' },
  { type: 'xnorGate', label: 'XNOR Gate', glyph: 'xnor', name: 'XNOR' },
];

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectError, setDetectError] = useState(null);
  const [rfInstance, setRfInstance] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [reviewPayload, setReviewPayload] = useState(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const { user, logout } = useAuth();
  const [touchSelectMode, setTouchSelectMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isTouch = useIsTouch();
  const { simulateCircuit } = useLogicSimulation();

  const updateNodeData = useCallback((nodeId, newData) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...newData } } : node
      )
    );
  }, [setNodes]);

  const nodeTypes = useMemo(() => ({
    input: (props) => <InputNode {...props} updateNodeData={updateNodeData} />,
    output: OutputNode,
    andGate: AndGateNode,
    notGate: NotGateNode,
    orGate: OrGateNode,
    xorGate: XorGateNode,
    nandGate: NandGateNode,
    xnorGate: XnorGateNode,
    norGate: NorGateNode,
  }), [updateNodeData]);

  useEffect(() => {
    const simulatedNodes = simulateCircuit(nodes, edges);

    const hasChanges = simulatedNodes.some((simNode, index) => {
      const originalNode = nodes[index];
      return originalNode && simNode.data.value !== originalNode.data.value;
    });

    if (hasChanges) {
      setNodes(simulatedNodes);
    }
  }, [nodes, edges, simulateCircuit, setNodes]);

  const onConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

  const addNode = useCallback((type, label, position) => {
    const newNode = {
      id: getId(),
      position: position || { x: 120 + Math.random() * 200, y: 80 + Math.random() * 220 },
      data: { label: label, value: 0 },
      type: type,
    };
    setNodes((nds) => nds.concat(newNode));
  }, [setNodes]);

  /**
   * Stash the dragged palette chip's node type for the canvas drop handler.
   * @param {DragEvent} event - HTML5 drag start event
   * @param {string} type - ReactFlow node type
   * @param {string} label - Node label
   */
  const onPaletteDragStart = useCallback((event, type, label) => {
    event.dataTransfer.setData('application/digisim', JSON.stringify({ type, label }));
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const onCanvasDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  /**
   * Drop a palette chip onto the canvas at the pointer's flow position.
   * @param {DragEvent} event - HTML5 drop event
   */
  const onCanvasDrop = useCallback((event) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData('application/digisim');
    if (!raw || !rfInstance) return;
    const { type, label } = JSON.parse(raw);
    const position = rfInstance.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });
    addNode(type, label, position);
  }, [rfInstance, addNode]);

  /**
   * Place a full detected circuit (components + wires) onto the canvas.
   * @param {import('./types/api').CircuitExportJSON} payload - /detect_circuit response
   */
  const importCircuit = useCallback((payload) => {
    const idMap = new Map();
    const newNodes = payload.components.map((component) => {
      const nodeId = getId();
      idMap.set(component.id, nodeId);
      return {
        id: nodeId,
        position: { x: component.x, y: component.y },
        data: { label: component.label, value: 0 },
        type: component.type,
      };
    });

    const newEdges = payload.connections
      .filter((c) => idMap.has(c.from) && idMap.has(c.to))
      .map((c) => ({
        id: `e${idMap.get(c.from)}-${idMap.get(c.to)}-${c.toPort || 'in'}`,
        source: idMap.get(c.from),
        target: idMap.get(c.to),
        sourceHandle: null,
        targetHandle: c.toPort,
      }));

    setNodes((nds) => nds.concat(newNodes));
    setEdges((eds) => eds.concat(newEdges));
    // Camera photos can be 4k wide — bring the placed circuit into view.
    setTimeout(() => rfInstance?.fitView({ padding: 0.15 }), 60);
  }, [setNodes, setEdges, rfInstance]);

  /**
   * Fall back to cloud gate detection (boxes only, no wires).
   * @param {FormData} formData - Multipart body carrying the image
   * @param {string} apiUrl - Backend base URL
   */
  const detectGatesFallback = useCallback(async (formData, apiUrl) => {
    const response = await fetch(`${apiUrl}/detect_gates`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    const detections = result.detections || result.predictions || [];
    console.log('Detected Gates:', detections);

    const newDetectedNodes = detections.map(detection => {
      let nodeType = '';
      let nodeLabel = '';

      // Map detector classes ('AND', 'and gate', ...) to node types and labels
      const detectedClass = (detection.class || '').toUpperCase().replace(' GATE', '');
      switch (detectedClass) {
        case 'AND':
          nodeType = 'andGate';
          nodeLabel = 'AND Gate';
          break;
        case 'OR':
          nodeType = 'orGate';
          nodeLabel = 'OR Gate';
          break;
        case 'NOT':
          nodeType = 'notGate';
          nodeLabel = 'NOT Gate';
          break;
        case 'NAND':
          nodeType = 'nandGate';
          nodeLabel = 'NAND Gate';
          break;
        case 'NOR':
          nodeType = 'norGate';
          nodeLabel = 'NOR Gate';
          break;
        case 'XOR':
          nodeType = 'xorGate';
          nodeLabel = 'XOR Gate';
          break;
        case 'XNOR':
          nodeType = 'xnorGate';
          nodeLabel = 'XNOR Gate';
          break;
        case 'INPUT':
        case 'SWITCH':
          nodeType = 'input';
          nodeLabel = 'Input';
          break;
        case 'OUTPUT':
        case 'LED':
          nodeType = 'output';
          nodeLabel = 'Output';
          break;
        default:
          nodeType = 'unknown'; // Handle unknown types
          nodeLabel = detection.class;
      }

      return {
        id: getId(),
        position: { x: detection.x - detection.width / 2, y: detection.y - detection.height / 2 },
        data: { label: nodeLabel, value: 0 },
        type: nodeType,
      };
    });

    setNodes((nds) => nds.concat(newDetectedNodes));
  }, [setNodes]);

  /**
   * Run circuit detection on an image: tries the full local pipeline
   * (/detect_circuit — gates AND wires) first, falling back to cloud gate
   * detection while local model weights are unavailable. Low-confidence
   * results are routed through the review step instead of the canvas.
   * @param {File|Blob} file - Circuit image to analyse
   */
  const runDetection = useCallback(async (file) => {
    if (!file) return;

    const formData = new FormData();
    formData.append('image', file, file.name || 'capture.jpg');
    const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:5001';

    setIsDetecting(true);
    setDetectError(null);
    try {
      const response = await fetch(`${apiUrl}/detect_circuit`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (response.ok) {
        const payload = await response.json();
        console.log('Detected circuit:', payload);
        // Don't silently trust low-confidence detections — let the user
        // correct or drop them first (model gate is F1/acc >= 0.95).
        if (payload.components.some((c) => c.confidence < 0.95)) {
          setReviewPayload(payload);
        } else {
          importCircuit(payload);
        }
      } else if (response.status === 503) {
        // Local pipeline not trained yet — cloud fallback (boxes only).
        console.warn('Local pipeline not ready, falling back to /detect_gates');
        await detectGatesFallback(formData, apiUrl);
      } else {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `HTTP error! status: ${response.status}`);
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      setDetectError(`Circuit detection failed: ${error.message}`);
    } finally {
      setIsDetecting(false);
    }
  }, [importCircuit, detectGatesFallback]);

  /**
   * File-input change handler feeding the detection flow.
   * @param {{ target: { files: File[], value: string } }} event - Input change
   */
  const handleImageUpload = useCallback((event) => {
    const file = event.target.files[0];
    event.target.value = ''; // allow re-selecting the same file
    runDetection(file);
  }, [runDetection]);

  /**
   * Camera modal capture handler.
   * @param {Blob} blob - Captured JPEG frame
   */
  const handleCameraCapture = useCallback((blob) => {
    setCameraOpen(false);
    runDetection(blob);
  }, [runDetection]);

  /** Fall back from the camera modal to a capture-enabled file input. */
  const handleCameraFallback = useCallback(() => {
    setCameraOpen(false);
    document.getElementById('camera-fallback-input')?.click();
  }, []);

  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);

  /**
   * Bulk-delete the selected nodes and every edge touching them.
   */
  const deleteSelection = useCallback(() => {
    const ids = new Set(selectedNodes.map((n) => n.id));
    setNodes((nds) => nds.filter((n) => !ids.has(n.id)));
    setEdges((eds) => eds.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
  }, [selectedNodes, setNodes, setEdges]);

  /**
   * Duplicate the selected nodes (and edges between them) offset down-right.
   */
  const duplicateSelection = useCallback(() => {
    const idMap = new Map();
    const clones = selectedNodes.map((node) => {
      const cloneId = getId();
      idMap.set(node.id, cloneId);
      return {
        ...node,
        id: cloneId,
        selected: false,
        position: { x: node.position.x + 48, y: node.position.y + 48 },
        data: { ...node.data },
      };
    });
    setNodes((nds) => nds.concat(clones));
    setEdges((eds) =>
      eds.concat(
        eds
          .filter((e) => idMap.has(e.source) && idMap.has(e.target))
          .map((e) => ({
            ...e,
            id: `e${idMap.get(e.source)}-${idMap.get(e.target)}-${e.targetHandle || 'in'}`,
            source: idMap.get(e.source),
            target: idMap.get(e.target),
            selected: false,
          }))
      )
    );
  }, [selectedNodes, setNodes, setEdges]);

  // Long-press on the canvas (touch only) toggles drag-to-select mode.
  const longPressTimer = React.useRef(null);

  /**
   * Arm the long-press timer that enables touch selection mode.
   * @param {React.TouchEvent} event - Touch start on the canvas wrapper
   */
  const onWrapperTouchStart = useCallback((event) => {
    if (event.touches.length !== 1) return;
    longPressTimer.current = setTimeout(() => {
      setTouchSelectMode(true);
      if (navigator.vibrate) navigator.vibrate(30);
    }, 550);
  }, []);

  const cancelLongPress = useCallback(() => {
    clearTimeout(longPressTimer.current);
  }, []);

  const clearCanvas = useCallback(() => {
    setNodes([]);
    setEdges([]);
    id = 5; // Reset ID counter
  }, [setNodes, setEdges]);

  const handleSampleImageSelect = useCallback(async (imageUrl) => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const file = new File([blob], imageUrl.split('/').pop(), { type: blob.type });

      const event = { target: { files: [file] } };
      handleImageUpload(event);
    } catch (error) {
      console.error('Error loading sample image:', error);
      alert('Failed to load sample image. Check console for details.');
    }
  }, [handleImageUpload]);

  // Wires carry their signal: edges driven by a HIGH source animate and glow.
  const nodeValues = useMemo(
    () => new Map(nodes.map((n) => [n.id, n.data.value])),
    [nodes]
  );
  const liveEdges = useMemo(
    () =>
      edges.map((edge) => {
        const on = nodeValues.get(edge.source) === 1;
        return {
          ...edge,
          type: 'smoothstep',
          pathOptions: { borderRadius: 16 },
          animated: on,
          className: on ? 'edge-on' : 'edge-off',
        };
      }),
    [edges, nodeValues]
  );

  const highCount = useMemo(
    () => nodes.filter((n) => n.data.value === 1).length,
    [nodes]
  );

  return (
    <div className="app-container">
      <div className="navbar">
        <div className="navbar-brand">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="12" cy="12" r="2.6" fill="currentColor" />
          </svg>
          <span className="brand-name">DigiSim</span>
          <span className="brand-tag">Circuit Analyzer</span>
        </div>
        <div className="navbar-status">
          <span className="stat-chip"><span className="stat-value">{nodes.length}</span> components</span>
          <span className="stat-chip"><span className="stat-value">{edges.length}</span> wires</span>
          <span className="stat-chip stat-chip--live">
            <span className="pulse-dot" /> {highCount} HIGH
          </span>
          {user && (
            <span className="stat-chip user-chip">
              {user.email}
              <button className="logout-btn" onClick={logout}>Log out</button>
            </span>
          )}
        </div>
      </div>
      {cameraOpen && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={() => setCameraOpen(false)}
          onFallback={handleCameraFallback}
        />
      )}
      {reviewPayload && (
        <DetectionReview
          payload={reviewPayload}
          onConfirm={(corrected) => {
            setReviewPayload(null);
            importCircuit(corrected);
          }}
          onCancel={() => setReviewPayload(null)}
        />
      )}
      <div className="content-wrapper">
        <button
          className="sidebar-toggle"
          aria-label="Toggle component drawer"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          {sidebarOpen ? '✕ Close' : '☰ Components'}
        </button>
        <div className={`sidebar${sidebarOpen ? ' sidebar--open' : ''}`}>
          <section className="palette-section">
            <h3>I/O</h3>
            <div className="palette-grid palette-grid--io">
              <button
                className="palette-chip"
                aria-label="Add Input"
                draggable
                onDragStart={(e) => onPaletteDragStart(e, 'input', 'Input')}
                onClick={() => addNode('input', 'Input')}
              >
                <span className="chip-icon chip-icon--switch" aria-hidden="true">⏻</span>
                <span className="chip-name">Input</span>
              </button>
              <button
                className="palette-chip"
                aria-label="Add Output"
                draggable
                onDragStart={(e) => onPaletteDragStart(e, 'output', 'Output')}
                onClick={() => addNode('output', 'Output')}
              >
                <span className="chip-icon chip-icon--led" aria-hidden="true" />
                <span className="chip-name">Output</span>
              </button>
            </div>
          </section>

          <section className="palette-section">
            <h3>Logic Gates</h3>
            <div className="palette-grid">
              {GATE_PALETTE.map((gate) => (
                <button
                  key={gate.type}
                  className="palette-chip"
                  aria-label={`Add ${gate.label}`}
                  draggable
                  onDragStart={(e) => onPaletteDragStart(e, gate.type, gate.label)}
                  onClick={() => addNode(gate.type, gate.label)}
                >
                  <GateGlyph type={gate.glyph} />
                  <span className="chip-name">{gate.name}</span>
                </button>
              ))}
            </div>
            <p className="palette-hint">click or drag onto the canvas</p>
          </section>

          <section className="palette-section">
            <h3>Vision</h3>
            <label htmlFor="image-upload-input" className="upload-button">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              Image Upload
            </label>
            <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden-file-input" id="image-upload-input" />
            <button className="upload-button camera-button" onClick={() => setCameraOpen(true)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
              Camera Capture
            </button>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleImageUpload}
              className="hidden-file-input"
              id="camera-fallback-input"
            />
            <SampleImages images={sampleImages} onImageSelect={handleSampleImageSelect} />
          </section>

          <div className="sidebar-footer">
            <button className="danger-button" onClick={clearCanvas}>Clear Canvas</button>
          </div>
        </div>
        <div
          className="reactflow-wrapper"
          onDrop={onCanvasDrop}
          onDragOver={onCanvasDragOver}
          onTouchStart={isTouch ? onWrapperTouchStart : undefined}
          onTouchMove={isTouch ? cancelLongPress : undefined}
          onTouchEnd={isTouch ? cancelLongPress : undefined}
        >
          {isTouch && touchSelectMode && (
            <button
              className="select-mode-chip"
              onClick={() => setTouchSelectMode(false)}
            >
              ▣ Selection mode — tap to exit
            </button>
          )}
          <SelectionToolbar
            selectedNodes={selectedNodes}
            viewport={viewport}
            onDelete={deleteSelection}
            onDuplicate={duplicateSelection}
          />
          {isDetecting && (
            <div className="detect-overlay" role="status">
              <span className="spinner" /> Detecting circuit…
            </div>
          )}
          {detectError && (
            <div className="detect-error" role="alert">
              {detectError}
              <button className="detect-error-dismiss" onClick={() => setDetectError(null)}>
                ✕
              </button>
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={liveEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setRfInstance}
            onMove={(_, vp) => setViewport(vp)}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.2}
            maxZoom={2.5}
            panOnScroll={!isTouch}
            zoomOnPinch
            // Desktop: left-drag draws a selection box, middle/right-drag pans.
            // Touch: single-finger pan stays off (conflicts with node drag);
            // two-finger pinch pans/zooms, long-press enables drag-select.
            selectionOnDrag={isTouch ? touchSelectMode : true}
            panOnDrag={isTouch ? !touchSelectMode : [1, 2]}
            selectionMode={SelectionMode.Partial}
            multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
            deleteKeyCode={['Backspace', 'Delete']}
            proOptions={{ hideAttribution: true }}
            connectionLineType="smoothstep"
          >
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => (n.data?.value === 1 ? '#4ade80' : '#334155')}
              maskColor="rgba(8, 12, 22, 0.72)"
            />
            <Controls />
            <Background variant="dots" gap={22} size={1.2} color="#1e293b" />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}

/**
 * App wrapped in ReactFlowProvider so drag-and-drop can resolve flow coordinates.
 * @returns {React.ReactElement} Provider-wrapped application
 */
function AppWithProvider() {
  return (
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>
  );
}

export default AppWithProvider;
