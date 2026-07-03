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
  addEdge,
  useNodesState,
  useEdgesState,
} from 'reactflow';

import 'reactflow/dist/style.css';
import './App.css';

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
  }, [setNodes, setEdges]);

  /**
   * Fall back to cloud gate detection (boxes only, no wires).
   * @param {FormData} formData - Multipart body carrying the image
   * @param {string} apiUrl - Backend base URL
   */
  const detectGatesFallback = useCallback(async (formData, apiUrl) => {
    const response = await fetch(`${apiUrl}/detect_gates`, {
      method: 'POST',
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
   * Upload an image and rebuild its circuit: tries the full local pipeline
   * (/detect_circuit — gates AND wires) first, falling back to cloud gate
   * detection while local model weights are unavailable.
   * @param {{ target: { files: File[] } }} event - File input change event
   */
  const handleImageUpload = useCallback(async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('image', file);
    const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:5001';

    setIsDetecting(true);
    setDetectError(null);
    try {
      const response = await fetch(`${apiUrl}/detect_circuit`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const payload = await response.json();
        console.log('Detected circuit:', payload);
        importCircuit(payload);
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
        </div>
      </div>
      <div className="content-wrapper">
        <div className="sidebar">
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
            <SampleImages images={sampleImages} onImageSelect={handleSampleImageSelect} />
          </section>

          <div className="sidebar-footer">
            <button className="danger-button" onClick={clearCanvas}>Clear Canvas</button>
          </div>
        </div>
        <div className="reactflow-wrapper" onDrop={onCanvasDrop} onDragOver={onCanvasDragOver}>
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
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.2}
            maxZoom={2.5}
            panOnScroll
            zoomOnPinch
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
