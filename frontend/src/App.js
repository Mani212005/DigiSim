/**
 * @file App.js
 * @description Root application component — owns all node/edge state and wires together
 * the ReactFlow canvas, logic simulation, and image detection pipeline.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import SampleImages from './components/SampleImages';
import './components/SampleImages.css';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
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

import { useLogicSimulation } from './hooks/useLogicSimulation';

const initialNodes = [
  { id: '1', position: { x: 0, y: 0 }, data: { label: 'Input A', value: 0 }, type: 'input' },
  { id: '2', position: { x: 0, y: 100 }, data: { label: 'Input B', value: 0 }, type: 'input' },
  { id: '3', position: { x: 200, y: 50 }, data: { label: 'AND Gate', value: 0 }, type: 'andGate' },
  { id: '4', position: { x: 400, y: 50 }, data: { label: 'Output', value: 0 }, type: 'output' },
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

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectError, setDetectError] = useState(null);
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

  const addNode = useCallback((type, label) => {
    const newNode = {
      id: getId(),
      position: { x: Math.random() * 250, y: Math.random() * 250 },
      data: { label: label, value: 0 },
      type: type,
    };
    setNodes((nds) => nds.concat(newNode));
  }, [setNodes]);

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

  return (
    <div className="app-container">
      <div className="navbar">
        <div className="navbar-brand">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7V17L12 22L22 17V7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M12 7L17 10L12 13L7 10L12 7Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 7L12 12L22 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M12 13L12 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Circuit Analyzer
        </div>
      </div>
      <div className="content-wrapper">
        <div className="sidebar">
          <h3>Add Components</h3>
          <button onClick={() => addNode('input', 'Input')}>Add Input</button>
          <button onClick={() => addNode('output', 'Output')}>Add Output</button>
          <button onClick={() => addNode('andGate', 'AND Gate')}>Add AND Gate</button>
          <button onClick={() => addNode('notGate', 'NOT Gate')}>Add NOT Gate</button>
          <button onClick={() => addNode('orGate', 'OR Gate')}>Add OR Gate</button>
          <button onClick={() => addNode('xorGate', 'XOR Gate')}>Add XOR Gate</button>
          <button onClick={() => addNode('nandGate', 'NAND Gate')}>Add NAND Gate</button>
          <button onClick={() => addNode('norGate', 'NOR Gate')}>Add NOR Gate</button>
          <button onClick={() => addNode('xnorGate', 'XNOR Gate')}>Add XNOR Gate</button>
          <hr />
          <h3>Image Upload</h3>
          <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden-file-input" id="image-upload-input" />
          <hr />
          <SampleImages images={sampleImages} onImageSelect={handleSampleImageSelect} />
          <hr />
          <button onClick={clearCanvas}>Clear Canvas</button>
        </div>
        <div className="reactflow-wrapper">
          {isDetecting && (
            <div className="detect-overlay" role="status">
              Detecting circuit…
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
            nodes={nodes.map(node => ({
              ...node,
              className: node.data.value === 1 ? 'node-on' : 'node-off',
            }))}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
          >
            <MiniMap />
            <Controls />
            <Background variant="dots" gap={12} size={1} />
          </ReactFlow>
        </div>
      </div>
      <div className="fab-container">
        <label htmlFor="image-upload-input" className="fab-button">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-upload"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
        </label>
      </div>
    </div>
  );
}
export default App;