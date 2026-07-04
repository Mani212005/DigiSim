/**
 * @file App.tsx
 * @description Root application component — owns all node/edge state and wires together
 * the ReactFlow canvas, logic simulation, and image detection pipeline. Renders the
 * circuit-lab UI: a collapsible schematic palette sidebar (click or drag to add),
 * signal-aware animated wires, multi-select tools, and the vision/camera flow.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SampleImages from './components/SampleImages';
import './components/SampleImages.css';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ReactFlowProvider,
  SelectionMode,
  addEdge,
  useNodesState,
  useEdgesState,
} from 'reactflow';
import type {
  Connection,
  NodeProps,
  NodeTypes,
  ReactFlowInstance,
  Viewport,
} from 'reactflow';

import 'reactflow/dist/style.css';
import './App.css';

import SelectionToolbar from './components/SelectionToolbar';
import { useIsTouch } from './hooks/useIsTouch';

import InputNode from './nodes/InputNode';
import OutputNode from './nodes/OutputNode';
import HardwareNode from './nodes/HardwareNode';
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
import { useLibrary } from './hooks/useLibrary';
import CameraCapture from './components/CameraCapture';
import DetectionReview from './components/DetectionReview';
import TerminalPanel from './components/TerminalPanel';
import NetlistPanel from './components/NetlistPanel';
import NetlistImportDialog from './components/NetlistImportDialog';
import ProjectsModal from './components/ProjectsModal';
import InventoryModal from './components/InventoryModal';
import { exportNetlist } from './logic/netlistIO';
import { useProjects } from './hooks/useProjects';
import type {
  ActiveProject,
  ApiErrorResponse,
  CanvasDropPayload,
  CircuitExportJSON,
  DetectGatesResponse,
  DigiEdge,
  DigiNode,
  GateDetection,
  LibraryComponent,
  NetlistImportPayload,
  NodeData,
  PaletteEntry,
  ProjectFolder,
  SaveStatus,
  UpdateNodeData,
} from './types';

const initialNodes: DigiNode[] = [
  { id: '1', position: { x: 0, y: 0 }, data: { label: 'Input A', value: 0 }, type: 'input' },
  { id: '2', position: { x: 0, y: 160 }, data: { label: 'Input B', value: 0 }, type: 'input' },
  { id: '3', position: { x: 260, y: 70 }, data: { label: 'AND Gate', value: 0 }, type: 'andGate' },
  { id: '4', position: { x: 520, y: 78 }, data: { label: 'Output', value: 0 }, type: 'output' },
];

const initialEdges: DigiEdge[] = [
  { id: 'e1-3', source: '1', target: '3', sourceHandle: null, targetHandle: 'a' },
  { id: 'e2-3', source: '2', target: '3', sourceHandle: null, targetHandle: 'b' },
  { id: 'e3-4', source: '3', target: '4' },
];

let id = 5;
const getId = (): string => `${id++}`;

/**
 * Ensure future getId() calls never collide with ids restored from a saved project.
 * @param loaded - Nodes loaded from a folder's saved circuit state
 */
const bumpIdCounter = (loaded: DigiNode[]): void => {
  const maxId = loaded.reduce((max, node) => {
    const value = Number(node.id);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
  id = Math.max(id, maxId + 1);
};

/** Autosave debounce: how long the canvas must be quiet before a save fires. */
const AUTOSAVE_MS = 1500;

const sampleImages = [
  'fifth_image.jpg',
  'fifty_image.jpg',
  'first_image.jpg',
  'forty_image.jpg',
  'fortyeight_image.jpg',
];

/** Sidebar palette definition: gate chips rendered with their schematic glyphs. */
const GATE_PALETTE: PaletteEntry[] = [
  { type: 'andGate', label: 'AND Gate', glyph: 'and', name: 'AND' },
  { type: 'orGate', label: 'OR Gate', glyph: 'or', name: 'OR' },
  { type: 'notGate', label: 'NOT Gate', glyph: 'not', name: 'NOT' },
  { type: 'nandGate', label: 'NAND Gate', glyph: 'nand', name: 'NAND' },
  { type: 'norGate', label: 'NOR Gate', glyph: 'nor', name: 'NOR' },
  { type: 'xorGate', label: 'XOR Gate', glyph: 'xor', name: 'XOR' },
  { type: 'xnorGate', label: 'XNOR Gate', glyph: 'xnor', name: 'XNOR' },
];

function App(): React.ReactElement {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [reviewPayload, setReviewPayload] = useState<CircuitExportJSON | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const { user, isGuest, logout } = useAuth();
  const [touchSelectMode, setTouchSelectMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Desktop toolbox: pinned = stays in layout; peek = hover overlay via ☰.
  const [sidebarPinned, setSidebarPinned] = useState(true);
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(250);
  const sidebarPeekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [netlistOpen, setNetlistOpen] = useState(true);
  const [netlistImportOpen, setNetlistImportOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [activeProject, setActiveProject] = useState<ActiveProject | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSave = useRef(false);
  const projectsApi = useProjects();
  const libraryApi = useLibrary();
  const [libraryComponents, setLibraryComponents] = useState<LibraryComponent[]>([]);
  const [librarySearch, setLibrarySearch] = useState('');
  const isTouch = useIsTouch();
  const { simulateCircuit } = useLogicSimulation();

  // Load the shared component library once for the placement palette.
  useEffect(() => {
    libraryApi
      .list()
      .then(setLibraryComponents)
      .catch(() => {} /* palette section just stays empty */);
  }, [libraryApi]);

  const filteredLibrary = useMemo(() => {
    const query = librarySearch.trim().toLowerCase();
    if (!query) return libraryComponents;
    return libraryComponents.filter((component) =>
      [component.canonical_name, ...component.aliases].some((name) =>
        name.toLowerCase().includes(query)
      )
    );
  }, [libraryComponents, librarySearch]);

  const updateNodeData = useCallback<UpdateNodeData>((nodeId, newData) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...newData } } : node
      )
    );
  }, [setNodes]);

  const nodeTypes = useMemo<NodeTypes>(() => ({
    input: (props: NodeProps<NodeData>) => (
      <InputNode {...props} updateNodeData={updateNodeData} />
    ),
    output: OutputNode,
    andGate: AndGateNode,
    notGate: NotGateNode,
    orGate: OrGateNode,
    xorGate: XorGateNode,
    nandGate: NandGateNode,
    xnorGate: XnorGateNode,
    norGate: NorGateNode,
    hardware: HardwareNode,
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

  // Ctrl/Cmd+J toggles the bottom terminal (like a code editor).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setTerminalOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const addNode = useCallback(
    (type: string, label: string, position?: { x: number; y: number }) => {
      const newNode: DigiNode = {
        id: getId(),
        position: position || { x: 120 + Math.random() * 200, y: 80 + Math.random() * 220 },
        data: { label, value: 0 },
        type,
      };
      setNodes((nds) => nds.concat(newNode));
    },
    [setNodes]
  );

  /**
   * Place a shared-library hardware component on the canvas with its pin map.
   * @param component - Library entry to place
   * @param position - Flow position (defaults to a jittered spot)
   */
  const addHardwareNode = useCallback(
    (component: LibraryComponent, position?: { x: number; y: number }) => {
      const nodeId = getId();
      const newNode: DigiNode = {
        id: nodeId,
        position:
          position || { x: 160 + Math.random() * 240, y: 90 + Math.random() * 200 },
        type: 'hardware',
        data: {
          label: component.canonical_name,
          value: 0,
          pins: component.pin_map.pins,
          libraryComponentId: component.id,
          category: component.category,
          imageId: null,
        },
      };
      setNodes((nds) => nds.concat(newNode));
      // Thumbnail: lazily fetch the part's first reference image, if any.
      if ((component.image_count ?? 0) > 0) {
        libraryApi
          .getComponent(component.id)
          .then((detail) => {
            if (detail.images.length > 0) {
              updateNodeData(nodeId, { imageId: detail.images[0].id });
            }
          })
          .catch(() => {});
      }
    },
    [setNodes, libraryApi, updateNodeData]
  );

  /**
   * Stash the dragged palette chip's node type for the canvas drop handler.
   * @param event - HTML5 drag start event
   * @param type - ReactFlow node type
   * @param label - Node label
   */
  const onPaletteDragStart = useCallback(
    (event: React.DragEvent, type: string, label: string) => {
      const payload: CanvasDropPayload = { kind: 'palette', type, label };
      event.dataTransfer.setData('application/digisim', JSON.stringify(payload));
      event.dataTransfer.effectAllowed = 'move';
    },
    []
  );

  /**
   * Stash a dragged library component for the canvas drop handler.
   * @param event - HTML5 drag start event
   * @param component - Library entry being dragged
   */
  const onLibraryDragStart = useCallback(
    (event: React.DragEvent, component: LibraryComponent) => {
      const payload: CanvasDropPayload = { kind: 'library', component };
      event.dataTransfer.setData('application/digisim', JSON.stringify(payload));
      event.dataTransfer.effectAllowed = 'move';
    },
    []
  );

  const onCanvasDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  /**
   * Drop a palette chip onto the canvas at the pointer's flow position.
   * @param event - HTML5 drop event
   */
  const onCanvasDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData('application/digisim');
      if (!raw || !rfInstance) return;
      const payload = JSON.parse(raw) as CanvasDropPayload;
      const position = rfInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      if (payload.kind === 'library') {
        addHardwareNode(payload.component, position);
      } else {
        addNode(payload.type, payload.label, position);
      }
    },
    [rfInstance, addNode, addHardwareNode]
  );

  /**
   * Place a full detected circuit (components + wires) onto the canvas.
   * @param payload - /detect_circuit response
   */
  const importCircuit = useCallback(
    (payload: CircuitExportJSON) => {
      const idMap = new Map<string, string>();
      const newNodes: DigiNode[] = payload.components.map((component) => {
        const nodeId = getId();
        idMap.set(component.id, nodeId);
        return {
          id: nodeId,
          position: { x: component.x, y: component.y },
          data: { label: component.label, value: 0 },
          type: component.type,
        };
      });

      const newEdges: DigiEdge[] = payload.connections
        .filter((c) => idMap.has(c.from) && idMap.has(c.to))
        .map((c) => ({
          id: `e${idMap.get(c.from)}-${idMap.get(c.to)}-${c.toPort || 'in'}`,
          source: idMap.get(c.from) as string,
          target: idMap.get(c.to) as string,
          sourceHandle: null,
          targetHandle: c.toPort,
        }));

      setNodes((nds) => nds.concat(newNodes));
      setEdges((eds) => eds.concat(newEdges));
      // Camera photos can be 4k wide — bring the placed circuit into view.
      setTimeout(() => rfInstance?.fitView({ padding: 0.15 }), 60);
    },
    [setNodes, setEdges, rfInstance]
  );

  /** Download the whole canvas as a canonical JSON netlist file. */
  const handleNetlistExport = useCallback(() => {
    const name =
      activeProject?.name.replace(/[^\w\- ]+/g, '').trim() || 'digisim-circuit';
    const doc = exportNetlist(nodes, edges, name);
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${name}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges, activeProject]);

  /** Save the open project immediately if an autosave is still pending. */
  const flushPendingSave = useCallback(async () => {
    if (!activeProject || saveTimer.current === null) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    await projectsApi
      .update(activeProject.id, { state: { nodes, edges } })
      .catch(() => {} /* best-effort — the folder keeps its previous save */);
  }, [activeProject, nodes, edges, projectsApi]);

  /**
   * Open a project folder: flush the previous one, then restore its exact
   * saved circuit state onto the canvas.
   * @param folder - Folder chosen in the projects modal
   */
  const openProject = useCallback(
    async (folder: ProjectFolder) => {
      setProjectsOpen(false);
      await flushPendingSave();
      try {
        const full = await projectsApi.get(folder.id);
        skipNextSave.current = true;
        setNodes(full.state.nodes ?? []);
        setEdges(full.state.edges ?? []);
        bumpIdCounter(full.state.nodes ?? []);
        setActiveProject({ id: full.id, name: full.name });
        setSaveStatus('saved');
        setTimeout(() => rfInstance?.fitView({ padding: 0.15 }), 60);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setDetectError(`Failed to open folder: ${message}`);
      }
    },
    [flushPendingSave, projectsApi, setNodes, setEdges, rfInstance]
  );

  /** Close the open project (canvas stays as-is, autosaving stops). */
  const closeProject = useCallback(async () => {
    await flushPendingSave();
    setActiveProject(null);
    setSaveStatus('idle');
  }, [flushPendingSave]);

  // Debounced autosave: persist the canvas AUTOSAVE_MS after the last change
  // while a project is open (skipping the render caused by loading it).
  useEffect(() => {
    if (!activeProject) return undefined;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return undefined;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      setSaveStatus('saving');
      projectsApi
        .update(activeProject.id, { state: { nodes, edges } })
        .then(() => setSaveStatus('saved'))
        .catch(() => setSaveStatus('error'));
    }, AUTOSAVE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [nodes, edges, activeProject, projectsApi]);

  // Best-effort flush of an unsaved project when the tab closes or reloads.
  useEffect(() => {
    const flushOnUnload = (): void => {
      if (!activeProject || saveTimer.current === null) return;
      projectsApi
        .update(activeProject.id, { state: { nodes, edges } }, true)
        .catch(() => {});
    };
    window.addEventListener('beforeunload', flushOnUnload);
    return () => window.removeEventListener('beforeunload', flushOnUnload);
  }, [activeProject, nodes, edges, projectsApi]);

  /**
   * Place a parsed netlist onto the canvas (appended, never replacing) by
   * remapping its local keys to fresh node ids.
   * @param payload - Validated netlist blueprints from the import dialog
   */
  const importNetlist = useCallback(
    (payload: NetlistImportPayload) => {
      setNetlistImportOpen(false);
      const idByKey = new Map<string, string>();
      const newNodes: DigiNode[] = payload.nodes.map((blueprint) => {
        const nodeId = getId();
        idByKey.set(blueprint.key, nodeId);
        return {
          id: nodeId,
          position: { x: blueprint.x, y: blueprint.y },
          data: { label: blueprint.label, value: 0 },
          type: blueprint.type,
        };
      });
      const newEdges: DigiEdge[] = payload.edges.map((e) => ({
        id: `e${idByKey.get(e.sourceKey)}-${idByKey.get(e.targetKey)}-${e.targetHandle || 'in'}`,
        source: idByKey.get(e.sourceKey) as string,
        target: idByKey.get(e.targetKey) as string,
        sourceHandle: null,
        targetHandle: e.targetHandle,
      }));
      setNodes((nds) => nds.concat(newNodes));
      setEdges((eds) => eds.concat(newEdges));
      setTimeout(() => rfInstance?.fitView({ padding: 0.15 }), 60);
    },
    [setNodes, setEdges, rfInstance]
  );

  /**
   * Fall back to cloud gate detection (boxes only, no wires).
   * @param formData - Multipart body carrying the image
   * @param apiUrl - Backend base URL
   */
  const detectGatesFallback = useCallback(
    async (formData: FormData, apiUrl: string) => {
      const response = await fetch(`${apiUrl}/detect_gates`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = (await response.json()) as DetectGatesResponse;
      const detections: GateDetection[] = result.detections || result.predictions || [];
      console.log('Detected Gates:', detections);

      const newDetectedNodes: DigiNode[] = detections.map((detection) => {
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
          position: {
            x: detection.x - detection.width / 2,
            y: detection.y - detection.height / 2,
          },
          data: { label: nodeLabel, value: 0 },
          type: nodeType,
        };
      });

      setNodes((nds) => nds.concat(newDetectedNodes));
    },
    [setNodes]
  );

  /**
   * Run circuit detection on an image: tries the full local pipeline
   * (/detect_circuit — gates AND wires) first, falling back to cloud gate
   * detection while local model weights are unavailable. Low-confidence
   * results are routed through the review step instead of the canvas.
   * @param file - Circuit image to analyse
   */
  const runDetection = useCallback(
    async (file: File | Blob) => {
      const formData = new FormData();
      const filename = file instanceof File ? file.name : 'capture.jpg';
      formData.append('image', file, filename);
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
          const payload = (await response.json()) as CircuitExportJSON;
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
          const body = (await response.json().catch(() => ({}))) as Partial<ApiErrorResponse>;
          throw new Error(body.error || `HTTP error! status: ${response.status}`);
        }
      } catch (error) {
        console.error('Error uploading image:', error);
        const message = error instanceof Error ? error.message : String(error);
        setDetectError(`Circuit detection failed: ${message}`);
      } finally {
        setIsDetecting(false);
      }
    },
    [importCircuit, detectGatesFallback]
  );

  /**
   * File-input change handler feeding the detection flow.
   * @param event - Input change event
   */
  const handleImageUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = ''; // allow re-selecting the same file
      if (file) runDetection(file);
    },
    [runDetection]
  );

  /**
   * Camera modal capture handler.
   * @param blob - Captured JPEG frame
   */
  const handleCameraCapture = useCallback(
    (blob: Blob) => {
      setCameraOpen(false);
      runDetection(blob);
    },
    [runDetection]
  );

  /** Fall back from the camera modal to a capture-enabled file input. */
  const handleCameraFallback = useCallback(() => {
    setCameraOpen(false);
    document.getElementById('camera-fallback-input')?.click();
  }, []);

  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);

  /** Bulk-delete the selected nodes and every edge touching them. */
  const deleteSelection = useCallback(() => {
    const ids = new Set(selectedNodes.map((n) => n.id));
    setNodes((nds) => nds.filter((n) => !ids.has(n.id)));
    setEdges((eds) => eds.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
  }, [selectedNodes, setNodes, setEdges]);

  /** Duplicate the selected nodes (and edges between them) offset down-right. */
  const duplicateSelection = useCallback(() => {
    const idMap = new Map<string, string>();
    const clones: DigiNode[] = selectedNodes.map((node) => {
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
            source: idMap.get(e.source) as string,
            target: idMap.get(e.target) as string,
            selected: false,
          }))
      )
    );
  }, [selectedNodes, setNodes, setEdges]);

  /** Keep the hover-peeked toolbox open (cancel any scheduled close). */
  const holdSidebarPeek = useCallback(() => {
    if (sidebarPeekTimer.current) clearTimeout(sidebarPeekTimer.current);
    setSidebarPeek(true);
  }, []);

  /** Schedule the hover-peeked toolbox to close shortly after mouse-out. */
  const releaseSidebarPeek = useCallback(() => {
    if (sidebarPeekTimer.current) clearTimeout(sidebarPeekTimer.current);
    sidebarPeekTimer.current = setTimeout(() => setSidebarPeek(false), 260);
  }, []);

  /**
   * Drag the toolbox's right edge to resize it.
   * @param event - Mouse-down on the resize handle
   */
  const startSidebarResize = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      const onMove = (move: MouseEvent): void =>
        setSidebarWidth(Math.min(430, Math.max(200, startWidth + (move.clientX - startX))));
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [sidebarWidth]
  );

  // Long-press on the canvas (touch only) toggles drag-to-select mode.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Arm the long-press timer that enables touch selection mode.
   * @param event - Touch start on the canvas wrapper
   */
  const onWrapperTouchStart = useCallback((event: React.TouchEvent) => {
    if (event.touches.length !== 1) return;
    longPressTimer.current = setTimeout(() => {
      setTouchSelectMode(true);
      if (navigator.vibrate) navigator.vibrate(30);
    }, 550);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  const clearCanvas = useCallback(() => {
    setNodes([]);
    setEdges([]);
    id = 5; // Reset ID counter
  }, [setNodes, setEdges]);

  /**
   * Load a bundled sample image and run it through detection.
   * @param imageUrl - Public URL of the sample image
   */
  const handleSampleImageSelect = useCallback(
    async (imageUrl: string) => {
      try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        const name = imageUrl.split('/').pop() ?? 'sample.jpg';
        runDetection(new File([blob], name, { type: blob.type }));
      } catch (error) {
        console.error('Error loading sample image:', error);
        setDetectError('Failed to load sample image.');
      }
    },
    [runDetection]
  );

  // Wires carry their signal: edges driven by a HIGH source animate and glow.
  const nodeValues = useMemo(
    () => new Map(nodes.map((n) => [n.id, n.data.value])),
    [nodes]
  );
  const liveEdges = useMemo<DigiEdge[]>(
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
          {activeProject && (
            <span className="stat-chip project-chip" title="Open project">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
              {activeProject.name}
              <span className={`save-status save-status--${saveStatus}`}>
                {saveStatus === 'saving'
                  ? 'Saving…'
                  : saveStatus === 'saved'
                    ? 'Saved ✓'
                    : saveStatus === 'error'
                      ? 'Save failed'
                      : ''}
              </span>
              <button
                className="logout-btn"
                onClick={closeProject}
                title="Close project (canvas stays, autosave stops)"
              >
                ✕
              </button>
            </span>
          )}
          <button
            className="stat-chip terminal-toggle"
            onClick={() => setProjectsOpen(true)}
            title="Projects — saved circuit folders"
          >
            🗀 Projects
          </button>
          {activeProject && (
            <button
              className="stat-chip terminal-toggle"
              onClick={() => setInventoryOpen(true)}
              title="Project inventory — parts list and reference photos"
            >
              ⛭ Inventory
            </button>
          )}
          <button
            className={`stat-chip terminal-toggle${terminalOpen ? ' terminal-toggle--on' : ''}`}
            onClick={() => setTerminalOpen((open) => !open)}
            title="Toggle terminal (Ctrl+J)"
          >
            ⌘ Terminal
          </button>
          {user ? (
            <span className="stat-chip user-chip">
              {user.email}
              <button className="logout-btn" onClick={logout}>Log out</button>
            </span>
          ) : isGuest ? (
            <span className="stat-chip user-chip">
              Guest
              <button className="logout-btn" onClick={logout}>Log in</button>
            </span>
          ) : null}
        </div>
      </div>
      {cameraOpen && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={() => setCameraOpen(false)}
          onFallback={handleCameraFallback}
        />
      )}
      {inventoryOpen && activeProject && (
        <InventoryModal
          folderId={activeProject.id}
          projectName={activeProject.name}
          onClose={() => setInventoryOpen(false)}
        />
      )}
      {projectsOpen && (
        <ProjectsModal
          activeProjectId={activeProject?.id ?? null}
          onOpenProject={openProject}
          onClose={() => setProjectsOpen(false)}
        />
      )}
      {netlistImportOpen && (
        <NetlistImportDialog
          onImport={importNetlist}
          onCancel={() => setNetlistImportOpen(false)}
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
        {!sidebarPinned && (
          <button
            className="sidebar-reveal-btn"
            aria-label="Show toolbox"
            title="Toolbox — hover to peek, click to pin"
            onMouseEnter={isTouch ? undefined : holdSidebarPeek}
            onMouseLeave={isTouch ? undefined : releaseSidebarPeek}
            onClick={() => {
              setSidebarPinned(true);
              setSidebarPeek(false);
            }}
          >
            ☰
          </button>
        )}
        <div
          className={`sidebar${sidebarOpen ? ' sidebar--open' : ''}${
            !sidebarPinned && !sidebarPeek ? ' sidebar--collapsed' : ''
          }${!sidebarPinned && sidebarPeek ? ' sidebar--peek' : ''}`}
          style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
          onMouseEnter={!sidebarPinned && !isTouch ? holdSidebarPeek : undefined}
          onMouseLeave={!sidebarPinned && !isTouch ? releaseSidebarPeek : undefined}
        >
          <div className="sidebar-head">
            <span className="sidebar-head__title">Toolbox</span>
            <button
              className="sidebar-collapse-btn"
              aria-label={sidebarPinned ? 'Close toolbox' : 'Pin toolbox open'}
              title={sidebarPinned ? 'Close — hover ☰ to peek' : 'Pin open'}
              onClick={() => {
                if (sidebarPinned) {
                  setSidebarPinned(false);
                } else {
                  setSidebarPinned(true);
                  setSidebarPeek(false);
                }
              }}
            >
              {sidebarPinned ? '☰' : '⊙'}
            </button>
          </div>
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
            <h3>Library</h3>
            <input
              className="library-search"
              placeholder={`Search ${libraryComponents.length} parts…`}
              value={librarySearch}
              aria-label="Search component library"
              onChange={(e) => setLibrarySearch(e.target.value)}
            />
            <div className="library-list">
              {filteredLibrary.map((component) => (
                <button
                  key={component.id}
                  className="library-chip"
                  aria-label={`Add ${component.canonical_name}`}
                  title={`${component.canonical_name} — click or drag onto the canvas`}
                  draggable
                  onDragStart={(e) => onLibraryDragStart(e, component)}
                  onClick={() => addHardwareNode(component)}
                >
                  <span className="library-chip__name">
                    {component.canonical_name}
                    {component.verified && <span className="library-chip__check"> ✓</span>}
                  </span>
                  <span className="library-chip__meta">
                    {component.category} · {component.pin_map.pins.length} pins
                  </span>
                </button>
              ))}
              {libraryComponents.length > 0 && filteredLibrary.length === 0 && (
                <p className="palette-hint">no matching parts</p>
              )}
            </div>
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
        {sidebarPinned && !isTouch && (
          <div
            className="panel-resizer"
            aria-hidden="true"
            onMouseDown={startSidebarResize}
          />
        )}
        <div className="canvas-column">
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
            connectionLineType={ConnectionLineType.SmoothStep}
          >
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => (n.data?.value === 1 ? '#4ade80' : '#334155')}
              maskColor="rgba(8, 12, 22, 0.72)"
            />
            <Controls />
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="#1e293b" />
          </ReactFlow>
        </div>
          <TerminalPanel
            nodes={nodes}
            edges={edges}
            open={terminalOpen}
            onClose={() => setTerminalOpen(false)}
          />
        </div>
        <NetlistPanel
          nodes={nodes}
          edges={edges}
          open={netlistOpen}
          onToggle={() => setNetlistOpen((netOpen) => !netOpen)}
          onExport={handleNetlistExport}
          onImportOpen={() => setNetlistImportOpen(true)}
        />
      </div>
    </div>
  );
}

/**
 * App wrapped in ReactFlowProvider so drag-and-drop can resolve flow coordinates.
 * @returns Provider-wrapped application
 */
function AppWithProvider(): React.ReactElement {
  return (
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>
  );
}

export default AppWithProvider;
