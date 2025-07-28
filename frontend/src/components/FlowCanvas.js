// eslint-disable-next-line no-unused-vars
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from 'reactflow';

import 'reactflow/dist/style.css';
import '../App.css';

import InputNode from '../nodes/InputNode';
import OutputNode from '../nodes/OutputNode';
import AndGateNode from '../nodes/AndGateNode';
import NotGateNode from '../nodes/NotGateNode';
import OrGateNode from '../nodes/OrGateNode';
import XorGateNode from '../nodes/XorGateNode';
import NandGateNode from '../nodes/NandGateNode';
import XnorGateNode from '../nodes/XnorGateNode';

import { useLogicSimulation } from '../hooks/useLogicSimulation';
import SampleImages from './SampleImages';

const initialNodes = [
  { id: '1', position: { x: 0, y: 0 }, data: { label: 'Input A', value: 0 }, type: 'input', draggable: true },
  { id: '2', position: { x: 0, y: 100 }, data: { label: 'Input B', value: 0 }, type: 'input', draggable: true },
  { id: '3', position: { x: 200, y: 50 }, data: { label: 'AND Gate', value: 0 }, type: 'andGate', draggable: true },
  { id: '4', position: { x: 400, y: 50 }, data: { label: 'Output', value: 0 }, type: 'output', draggable: true },
];

const initialEdges = [
  { id: 'e1-3', source: '1', target: '3', sourceHandle: null, targetHandle: 'a' },
  { id: 'e2-3', source: '2', target: '3', sourceHandle: null, targetHandle: 'b' },
  { id: 'e3-4', source: '3', target: '4' },
];

let id = 5;
const getId = () => `${id++}`;

function FlowCanvas({ sampleImages }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { simulateCircuit } = useLogicSimulation();
  const reactFlowWrapper = useRef(null);
  const reactFlowInstance = useRef(null);

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
    if (!reactFlowInstance.current) return; // Ensure instance is available

    const viewport = reactFlowInstance.current.getViewport();
    const centerX = viewport.x + viewport.width / 2;
    const centerY = viewport.y + viewport.height / 2;

    const newNode = {
      id: getId(),
      position: { x: 100, y: 100 },
      data: { label: label, value: 0 },
      type: type,
      draggable: true,
    };
    setNodes((prevNodes) => [...prevNodes, newNode]);
  }, [setNodes]);

  const handleImageUpload = useCallback(async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('image', file);

    try {
      const response = await fetch('http://localhost:5001/detect_gates', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('Detected Gates:', result.detections);

      const newDetectedNodes = result.detections.map(detection => {
        let nodeType = '';
        let nodeLabel = '';

        // Map Roboflow classes to our node types and labels
        switch (detection.class) {
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
      if (reactFlowInstance.current) {
        reactFlowInstance.current.fitView({ padding: 0.2 }); // Add padding to fitView
      }

    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Failed to upload image or detect gates. Check console for details.');
    }
  }, [setNodes]);

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
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          nodesDraggable={true}
            onInit={(instance) => reactFlowInstance.current = instance}
        >
          <MiniMap />
          <Controls />
          <Background variant="dots" gap={12} size={1} />
        </ReactFlow>
      </div>
      <div className="fab-container">
        <label htmlFor="image-upload-input" className="fab-button">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="feather feather-upload"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
        </label>
      </div>
    </div>
  );
}

export default FlowCanvas;
