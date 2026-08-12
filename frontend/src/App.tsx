/**
 * @file App.tsx
 * @description Root application component — owns all node/edge state and wires together
 * the ReactFlow canvas, logic simulation, and image detection pipeline. Renders the
 * circuit-lab UI: a collapsible schematic palette sidebar (click or drag to add),
 * signal-aware animated wires, multi-select tools, and the vision/camera flow.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
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
import InspectorPanel from './components/InspectorPanel';
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
import {
  AnalogSwitchNode,
  BjtNpnNode,
  BjtPnpNode,
  CapacitorNode,
  ClockSourceNode,
  GroundNode,
  InductorNode,
  LedNode,
  PotentiometerNode,
  ResistorNode,
  VSourceNode,
} from './nodes/AnalogNodes';
import NmosNode from './components/nodes/NmosNode';
import PmosNode from './components/nodes/PmosNode';
import SubcktNode from './components/nodes/SubcktNode';
import { CellRegistry } from './logic/hierarchy/CellRegistry';

import { useLogicSimulation } from './hooks/useLogicSimulation';
import { useAuth } from './hooks/useAuth';
import { useLibrary } from './hooks/useLibrary';
import CameraCapture from './components/CameraCapture';
import DetectionReview from './components/DetectionReview';
import PhotoReview from './components/PhotoReview';
import TerminalPanel from './components/TerminalPanel';
import NetlistPanel from './components/NetlistPanel';
import NetlistImportDialog from './components/NetlistImportDialog';
import ProjectsModal from './components/ProjectsModal';
import InventoryModal from './components/InventoryModal';
import Sidebar from './components/Sidebar';
import FalstadFlowOverlay from './components/canvas/FalstadFlowOverlay';
import InteractiveProbeTooltip from './components/canvas/InteractiveProbeTooltip';
import CircuitHealthBar from './components/hud/CircuitHealthBar';
import DigiCopilotPanel from './components/hud/DigiCopilotPanel';
import Pcb3DViewer from './components/canvas/Pcb3DViewer';
import CircuitGalleryModal from './components/showcase/CircuitGalleryModal';
import InteractiveTourModal from './components/onboarding/InteractiveTourModal';
import CommandPaletteModal from './components/palette/CommandPaletteModal';
import HotkeyCheatsheetModal, { HotkeyFloatingTrigger } from './components/hud/HotkeyCheatsheetModal';
import ComponentPropertiesModal from './components/hud/ComponentPropertiesModal';
import { exportNetlist } from './logic/netlistIO';
import { downloadGerberFile } from './logic/gerberExport';
import { downloadSpiceNetlist, downloadSpectreNetlist } from './logic/simulation/netlistSpice';
import { useProjects } from './hooks/useProjects';
import type { TechNode } from './types/pdk';
import type {
  ActiveProject,
  ApiErrorResponse,
  CanvasDropPayload,
  CircuitExportJSON,
  DetectGatesResponse,
  DetectV2PhotoResponse,
  DetectV2Response,
  DigiEdge,
  DigiNode,
  GateDetection,
  LibraryComponent,
  LibraryComponentDetail,
  NetlistImportPayload,
  NodeData,
  PaletteEntry,
  PhotoPlacement,
  ProjectFolder,
  SampleCircuit,
  SaveStatus,
  SidebarView,
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
/** Analog parts palette: chip metadata + fresh-node parameter defaults. */
const ANALOG_PALETTE: { type: string; label: string; name: string; hint: string }[] = [
  { type: 'vsource', label: 'Voltage Source', name: 'Source', hint: '5V DC' },
  { type: 'ground', label: 'Ground', name: 'GND', hint: '0V reference' },
  { type: 'clockSource', label: 'Clock Generator', name: 'Clock', hint: '10 MHz Pulse' },
  { type: 'resistor', label: 'Resistor', name: 'Resistor', hint: '220Ω' },
  { type: 'capacitor', label: 'Capacitor', name: 'Capacitor', hint: '10 pF' },
  { type: 'inductor', label: 'Inductor', name: 'Inductor', hint: '100 nH' },
  { type: 'led', label: 'LED', name: 'LED', hint: 'glows by current' },
  { type: 'analogSwitch', label: 'Switch', name: 'Switch', hint: 'click to toggle' },
  { type: 'potentiometer', label: 'Potentiometer', name: 'Pot', hint: '10kΩ' },
  { type: 'nmos', label: 'NMOS Transistor', name: 'NMOS', hint: '4-Terminal MOSFET' },
  { type: 'pmos', label: 'PMOS Transistor', name: 'PMOS', hint: '4-Terminal MOSFET' },
  { type: 'bjtNpn', label: 'NPN BJT', name: 'BJT NPN', hint: 'Bipolar Transistor' },
  { type: 'bjtPnp', label: 'PNP BJT', name: 'BJT PNP', hint: 'Bipolar Transistor' },
  { type: 'subckt', label: 'Sub-Circuit Block', name: 'Subckt', hint: 'OpenAccess Subckt' },
];

/** Initial data.param/percent/closed values per analog node type. */
const ANALOG_DEFAULT_DATA: Record<string, Partial<NodeData>> = {
  vsource: { param: 5 },
  clockSource: { param: 10 },
  resistor: { param: 220 },
  capacitor: { param: 10 },
  inductor: { param: 100 },
  potentiometer: { param: 10000, percent: 50 },
  analogSwitch: { closed: false },
  nmos: { techNode: '180nm', width: 1.2, length: 0.18, nf: 1, autoBulk: true },
  pmos: { techNode: '180nm', width: 2.4, length: 0.18, nf: 1, autoBulk: true },
  bjtNpn: { label: 'Q1', param: 100 },
  bjtPnp: { label: 'Q2', param: 80 },
  subckt: { cellName: 'INVERTER', params: { W_p: 2.4, W_n: 1.2, L: 0.18 } },
};

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
  const [photoReview, setPhotoReview] = useState<DetectV2PhotoResponse | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const { user, isGuest, logout } = useAuth();
  const [touchSelectMode, setTouchSelectMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Desktop toolbox: pinned = stays in layout; peek = hover overlay via ☰.
  const [sidebarPinned, setSidebarPinned] = useState(true);
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(250);
  const [sidebarView, setSidebarView] = useState<SidebarView>('menu');
  const sidebarPeekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [netlistOpen, setNetlistOpen] = useState(true);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [pcb3dOpen, setPcb3dOpen] = useState(false);
  const [netlistImportOpen, setNetlistImportOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [hotkeyCheatsheetOpen, setHotkeyCheatsheetOpen] = useState(false);
  const [propModalOpen, setPropModalOpen] = useState(false);
  const [selectedPropNode, setSelectedPropNode] = useState<DigiNode | null>(null);
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<'file' | 'simulate' | 'tools' | 'help' | null>(null);
  const [activeTechNode, setActiveTechNode] = useState<TechNode>('180nm');
  const [isSimulating, setIsSimulating] = useState(true);
  const [wireMode, setWireMode] = useState(false);
  const [probeMode, setProbeMode] = useState(false);
  const [history, setHistory] = useState<Array<{ nodes: DigiNode[]; edges: DigiEdge[] }>>([]);
  const [activeProject, setActiveProject] = useState<ActiveProject | null>(null);

  const pushHistory = useCallback(() => {
    setHistory((prev) => [...prev.slice(-30), { nodes, edges }]);
  }, [nodes, edges]);

  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setHistory((prev) => prev.slice(0, prev.length - 1));
    setNodes(previous.nodes);
    setEdges(previous.edges);
  }, [history, setNodes, setEdges]);

  const handleSwitchPDK = useCallback((techNode: TechNode) => {
    setActiveTechNode(techNode);
    setNodes((nds) =>
      nds.map((node) => {
        if (node.type === 'nmos' || node.type === 'pmos') {
          return {
            ...node,
            data: {
              ...node.data,
              techNode,
            },
          };
        }
        return node;
      })
    );
  }, [setNodes]);

  const handleSpiceExport = useCallback(() => {
    const name =
      activeProject?.name.replace(/[^\w\- ]+/g, '').trim() || 'digisim_circuit';
    downloadSpiceNetlist(nodes, edges, name);
    setExportDropdownOpen(false);
  }, [nodes, edges, activeProject]);

  const handleSpectreExport = useCallback(() => {
    const name =
      activeProject?.name.replace(/[^\w\- ]+/g, '').trim() || 'digisim_circuit';
    downloadSpectreNetlist(nodes, edges, name);
    setExportDropdownOpen(false);
  }, [nodes, edges, activeProject]);

  const handleGerberExport = useCallback(() => {
    const name =
      activeProject?.name.replace(/[^\w\- ]+/g, '').trim() || 'digisim_top_copper';
    downloadGerberFile(nodes, edges, name);
    setExportDropdownOpen(false);
  }, [nodes, edges, activeProject]);

  // Listener for double-clicking nodes / digisim:open-node-properties
  useEffect(() => {
    const handleOpenProps = (e: Event) => {
      const customEvent = e as CustomEvent<{ nodeId: string }>;
      const targetNode = nodes.find((n) => n.id === customEvent.detail?.nodeId);
      if (targetNode) {
        setSelectedPropNode(targetNode);
        setPropModalOpen(true);
      }
    };
    window.addEventListener('digisim:open-node-properties', handleOpenProps);
    return () => window.removeEventListener('digisim:open-node-properties', handleOpenProps);
  }, [nodes]);

  // Close menus when clicking outside
  useEffect(() => {
    const closeMenus = () => {
      setActiveMenu(null);
      setExportDropdownOpen(false);
    };
    window.addEventListener('click', closeMenus);
    return () => window.removeEventListener('click', closeMenus);
  }, []);

  // Check on initial mount whether the user has completed the onboarding tour
  useEffect(() => {
    try {
      const tourSeen = localStorage.getItem('digisim_tour_completed');
      if (!tourSeen) {
        const timer = setTimeout(() => setTourOpen(true), 800);
        return () => clearTimeout(timer);
      }
    } catch {
      /* ignore storage access errors in restricted environments */
    }
  }, []);

  /**
   * Load a curated sample circuit into the ReactFlow schematic canvas.
   * @param circuit - Selected sample circuit metadata, nodes, and edges
   */
  const handleLoadSampleCircuit = useCallback(
    (circuit: SampleCircuit) => {
      const newNodes = circuit.nodes.map((n) => ({
        ...n,
        position: { ...n.position },
        data: { ...n.data },
      }));
      const newEdges = circuit.edges.map((e) => ({ ...e }));

      bumpIdCounter(newNodes);
      setNodes(newNodes);
      setEdges(newEdges);
      setGalleryOpen(false);

      setTimeout(() => {
        rfInstance?.fitView({ padding: 0.15 });
      }, 60);
    },
    [rfInstance, setNodes, setEdges]
  );

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSave = useRef(false);
  const projectsApi = useProjects();
  const libraryApi = useLibrary();
  const [libraryComponents, setLibraryComponents] = useState<LibraryComponent[]>([]);
  const [librarySearch, setLibrarySearch] = useState('');
  const isTouch = useIsTouch();
  const { simulateCircuit } = useLogicSimulation();

  const [hierarchyStack, setHierarchyStack] = useState<
    Array<{ label: string; cellName: string; nodes: DigiNode[]; edges: DigiEdge[] }>
  >([]);

  const handleDrillDown = useCallback(
    (cellName: string, params: Record<string, number | string>) => {
      const instantiated = CellRegistry.instantiateSchematic(cellName, params, `sub_${Date.now()}`);
      if (instantiated.nodes.length === 0) {
        alert(`No schematic view found for cell '${cellName}'.`);
        return;
      }
      setHierarchyStack((prev) => [
        ...prev,
        { label: cellName, cellName, nodes, edges },
      ]);
      setNodes(instantiated.nodes);
      setEdges(instantiated.edges);
      setTimeout(() => rfInstance?.fitView({ padding: 0.15 }), 60);
    },
    [nodes, edges, setNodes, setEdges, rfInstance]
  );

  useEffect(() => {
    const onCustomDrillDown = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.cellName) {
        handleDrillDown(detail.cellName, detail.params || {});
      }
    };
    window.addEventListener('digisim:drilldown', onCustomDrillDown);
    return () => window.removeEventListener('digisim:drilldown', onCustomDrillDown);
  }, [handleDrillDown]);

  const handlePopHierarchy = useCallback(() => {
    if (hierarchyStack.length === 0) return;
    const previous = hierarchyStack[hierarchyStack.length - 1];
    setHierarchyStack((prev) => prev.slice(0, prev.length - 1));
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setTimeout(() => rfInstance?.fitView({ padding: 0.15 }), 60);
  }, [hierarchyStack, setNodes, setEdges, rfInstance]);

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
    hardware: (props: NodeProps<NodeData>) => (
      <HardwareNode
        id={props.id}
        data={props.data}
        updateNodeData={updateNodeData}
        onPinsSaved={(componentId, pins) => {
          // Best-effort share-back: the canvas node already has the pins.
          libraryApi.updatePins(componentId, pins).catch(() => {});
        }}
      />
    ),
    vsource: (props: NodeProps<NodeData>) => (
      <VSourceNode id={props.id} data={props.data} updateNodeData={updateNodeData} />
    ),
    ground: GroundNode,
    clockSource: (props: NodeProps<NodeData>) => (
      <ClockSourceNode id={props.id} data={props.data} updateNodeData={updateNodeData} />
    ),
    resistor: (props: NodeProps<NodeData>) => (
      <ResistorNode id={props.id} data={props.data} updateNodeData={updateNodeData} />
    ),
    capacitor: (props: NodeProps<NodeData>) => (
      <CapacitorNode id={props.id} data={props.data} updateNodeData={updateNodeData} />
    ),
    inductor: (props: NodeProps<NodeData>) => (
      <InductorNode id={props.id} data={props.data} updateNodeData={updateNodeData} />
    ),
    led: LedNode,
    analogSwitch: (props: NodeProps<NodeData>) => (
      <AnalogSwitchNode id={props.id} data={props.data} updateNodeData={updateNodeData} />
    ),
    potentiometer: (props: NodeProps<NodeData>) => (
      <PotentiometerNode id={props.id} data={props.data} updateNodeData={updateNodeData} />
    ),
    nmos: (props: NodeProps<NodeData>) => (
      <NmosNode id={props.id} data={props.data} updateNodeData={updateNodeData} />
    ),
    pmos: (props: NodeProps<NodeData>) => (
      <PmosNode id={props.id} data={props.data} updateNodeData={updateNodeData} />
    ),
    bjtNpn: (props: NodeProps<NodeData>) => (
      <BjtNpnNode id={props.id} data={props.data} updateNodeData={updateNodeData} />
    ),
    bjtPnp: (props: NodeProps<NodeData>) => (
      <BjtPnpNode id={props.id} data={props.data} updateNodeData={updateNodeData} />
    ),
    subckt: (props: NodeProps<NodeData>) => (
      <SubcktNode id={props.id} data={props.data} updateNodeData={updateNodeData} />
    ),
  }), [updateNodeData, libraryApi]);

  // Sim clock: ticks only while some board pin blinks (time-dependent
  // behavior); static circuits re-solve on edits alone.
  const needsClock = useMemo(
    () =>
      nodes.some(
        (n) =>
          n.type === 'hardware' &&
          Object.values(n.data.pinConfig ?? {}).some((c) => c.mode === 'blink')
      ),
    [nodes]
  );
  const [simTime, setSimTime] = useState(0);
  useEffect(() => {
    if (!needsClock) return undefined;
    const timer = setInterval(() => setSimTime((Date.now() % 86400000) / 1000), 200);
    return () => clearInterval(timer);
  }, [needsClock]);

  useEffect(() => {
    if (!isSimulating) return;
    const simulatedNodes = simulateCircuit(nodes, edges, simTime);

    // Re-render when any simulation output changed (digital value or analog
    // solve results). simulate() is deterministic, so this settles in one pass.
    const hasChanges = simulatedNodes.some((simNode, index) => {
      const original = nodes[index];
      return (
        original &&
        (simNode.data.value !== original.data.value ||
          simNode.data.current !== original.data.current ||
          simNode.data.voltageDrop !== original.data.voltageDrop ||
          simNode.data.brightness !== original.data.brightness ||
          simNode.data.simWarning !== original.data.simWarning)
      );
    });

    if (hasChanges) {
      setNodes(simulatedNodes);
    }
  }, [nodes, edges, simulateCircuit, setNodes, simTime, isSimulating]);

  // Global Keyboard Shortcuts (Cmd+K, Cmd+J, Cmd+Z, Space, ?, W, P, Esc)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      // Cmd+K / Ctrl+K: Command Palette
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen((open) => !open);
        return;
      }

      // Ctrl/Cmd+J toggles the bottom terminal (like a code editor).
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setTerminalOpen((open) => !open);
        return;
      }

      // Cmd+Z / Ctrl+Z: Undo (when not typing inside an input)
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        if (!isInput) {
          event.preventDefault();
          handleUndo();
          return;
        }
      }

      // Ignore single-letter shortcuts when typing in inputs
      if (isInput) return;

      if (event.key === '?' || (event.shiftKey && event.key === '/')) {
        event.preventDefault();
        setHotkeyCheatsheetOpen((open) => !open);
      } else if (event.key === 'Escape') {
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
        } else if (hotkeyCheatsheetOpen) {
          setHotkeyCheatsheetOpen(false);
        } else if (hierarchyStack.length > 0) {
          handlePopHierarchy();
        }
      } else if (event.code === 'Space') {
        event.preventDefault();
        setIsSimulating((sim) => !sim);
      } else if (event.key.toLowerCase() === 'w' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        setWireMode((wm) => !wm);
      } else if (event.key.toLowerCase() === 'p' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        setProbeMode((pm) => !pm);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    commandPaletteOpen,
    hotkeyCheatsheetOpen,
    hierarchyStack.length,
    handlePopHierarchy,
    handleUndo,
  ]);

  const onConnect = useCallback(
    (params: Connection) => {
      pushHistory();
      setEdges((eds) => addEdge(params, eds));
    },
    [setEdges, pushHistory]
  );

  const addNode = useCallback(
    (
      type: string,
      label: string,
      position?: { x: number; y: number },
      extraData?: Record<string, unknown>
    ) => {
      pushHistory();
      const newNode: DigiNode = {
        id: getId(),
        position: position || { x: 120 + Math.random() * 200, y: 80 + Math.random() * 220 },
        data: { label, value: 0, ...ANALOG_DEFAULT_DATA[type], ...extraData },
        type,
      };
      setNodes((nds) => nds.concat(newNode));
    },
    [setNodes, pushHistory]
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
          editablePins: component.source === 'community',
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

  /**
   * Place confirmed photo detections as hardware nodes, laid out in the
   * photo's arrangement (box top-left corners in source-image pixels).
   * @param placements - Identified detections confirmed in the review dialog
   */
  const placePhotoComponents = useCallback(
    async (placements: PhotoPlacement[]) => {
      setPhotoReview(null);
      // One detail fetch per distinct component (pin map + thumbnail image).
      const details = new Map<number, LibraryComponentDetail>();
      await Promise.all(
        Array.from(new Set(placements.map((p) => p.componentId))).map(async (id) => {
          try {
            details.set(id, await libraryApi.getComponent(id));
          } catch {
            /* component vanished — its placements are skipped below */
          }
        })
      );
      const newNodes: DigiNode[] = [];
      placements.forEach((placement) => {
        const detail = details.get(placement.componentId);
        if (!detail) return;
        newNodes.push({
          id: getId(),
          position: { x: placement.box.x1, y: placement.box.y1 },
          type: 'hardware',
          data: {
            label: detail.canonical_name,
            value: 0,
            pins: detail.pin_map.pins,
            libraryComponentId: detail.id,
            category: detail.category,
            imageId: detail.images[0]?.id ?? null,
            editablePins: detail.source === 'community',
          },
        });
      });
      setNodes((nds) => nds.concat(newNodes));
      // Photo coordinates can be 4k wide — bring the placed parts into view.
      setTimeout(() => rfInstance?.fitView({ padding: 0.15 }), 60);
    },
    [libraryApi, setNodes, rfInstance]
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
   * Run circuit detection on an image. /detect_v2 routes the image first:
   * physical-build photos go to open-set recognition (proposals + retrieval,
   * reviewed in PhotoReview before placement); drawn schematics fall through
   * to the classic pipeline (/detect_circuit — gates AND wires), with cloud
   * gate detection as a last resort while local weights are unavailable.
   * Low-confidence results always route through a review step.
   * @param file - Circuit image to analyse
   */
  const runDetection = useCallback(
    async (file: File | Blob) => {
      const formData = new FormData();
      const filename = file instanceof File ? file.name : 'capture.jpg';
      formData.append('image', file, filename);
      // The open project's inventory constrains photo recognition.
      if (activeProject) formData.append('folder_id', String(activeProject.id));
      const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:5001';

      setIsDetecting(true);
      setDetectError(null);
      try {
        try {
          const v2 = await fetch(`${apiUrl}/detect_v2`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
          });
          if (v2.ok) {
            const verdict = (await v2.json()) as DetectV2Response;
            if (verdict.domain === 'photo') {
              setPhotoReview(verdict);
              return;
            }
            // domain === 'schematic': fall through to the gate pipeline.
          }
        } catch {
          /* recognition service unavailable — the gate pipeline still works */
        }

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
    [importCircuit, detectGatesFallback, activeProject]
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
      // One width update per animation frame — per-mousemove updates make
      // ReactFlow's ResizeObserver loop and trip the CRA dev-error overlay.
      let frame = 0;
      const onMove = (move: MouseEvent): void => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          setSidebarWidth(
            Math.min(430, Math.max(200, startWidth + (move.clientX - startX)))
          );
        });
      };
      const onUp = (): void => {
        if (frame) cancelAnimationFrame(frame);
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

  return (
    <div className="app-container">
      <header className="navbar">
        {/* Left Section: Brand & Toolbar Menus */}
        <div className="navbar-left">
          <div className="navbar-brand" title="DigiSim Virtuoso EDA Workstation">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <path d="M9 3v18M15 3v18" />
            </svg>
            <span>DigiSim</span>
            <span className="brand-tag">v2.0 Pro</span>
          </div>

          <div className="nav-divider" />

          {/* Professional Menu Toolbar Dropdowns */}
          <nav className="nav-menu-bar" onClick={(e) => e.stopPropagation()}>
            {/* File Menu */}
            <div className="nav-menu-item">
              <button
                type="button"
                className={`nav-menu-btn ${activeMenu === 'file' ? 'nav-menu-btn--active' : ''}`}
                onClick={() => setActiveMenu((m) => (m === 'file' ? null : 'file'))}
              >
                File <span className="nav-menu-arrow">▾</span>
              </button>
              {activeMenu === 'file' && (
                <div className="nav-dropdown">
                  <label htmlFor="header-image-upload" className="nav-dropdown-item" style={{ cursor: 'pointer' }}>
                    <span>📷 Upload Schematic Image</span>
                  </label>
                  <button
                    type="button"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setNetlistImportOpen(true);
                      setActiveMenu(null);
                    }}
                  >
                    <span>📥 Import Netlist</span>
                  </button>
                  <button
                    type="button"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setProjectsOpen(true);
                      setActiveMenu(null);
                    }}
                  >
                    <span>🗀 Projects Manager</span>
                  </button>
                  {activeProject && (
                    <button
                      type="button"
                      className="nav-dropdown-item"
                      onClick={() => {
                        setInventoryOpen(true);
                        setActiveMenu(null);
                      }}
                    >
                      <span>⛭ Project Inventory</span>
                    </button>
                  )}
                  <div className="nav-dropdown-sep" />
                  <button
                    type="button"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setNodes([]);
                      setEdges([]);
                      setActiveMenu(null);
                    }}
                  >
                    <span>🗑 Clear Canvas</span>
                  </button>
                </div>
              )}
            </div>

            {/* Simulate Menu */}
            <div className="nav-menu-item">
              <button
                type="button"
                className={`nav-menu-btn ${activeMenu === 'simulate' ? 'nav-menu-btn--active' : ''}`}
                onClick={() => setActiveMenu((m) => (m === 'simulate' ? null : 'simulate'))}
              >
                Simulate <span className="nav-menu-arrow">▾</span>
              </button>
              {activeMenu === 'simulate' && (
                <div className="nav-dropdown">
                  <button
                    type="button"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setIsSimulating((s) => !s);
                      setActiveMenu(null);
                    }}
                  >
                    <span>{isSimulating ? '⏸ Pause Simulation' : '▶ Run Simulation'}</span>
                    <span className="nav-dropdown-kbd">Space</span>
                  </button>
                  <button
                    type="button"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setIsSimulating(false);
                      setActiveMenu(null);
                    }}
                  >
                    <span>⏭ Single Step</span>
                  </button>
                  <button
                    type="button"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setIsSimulating(false);
                      setActiveMenu(null);
                    }}
                  >
                    <span>↺ Reset Simulation</span>
                  </button>
                </div>
              )}
            </div>

            {/* Tools Menu */}
            <div className="nav-menu-item">
              <button
                type="button"
                className={`nav-menu-btn ${activeMenu === 'tools' ? 'nav-menu-btn--active' : ''}`}
                onClick={() => setActiveMenu((m) => (m === 'tools' ? null : 'tools'))}
              >
                Tools <span className="nav-menu-arrow">▾</span>
              </button>
              {activeMenu === 'tools' && (
                <div className="nav-dropdown">
                  <button
                    type="button"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setCommandPaletteOpen(true);
                      setActiveMenu(null);
                    }}
                  >
                    <span>⌘ Command Palette</span>
                    <span className="nav-dropdown-kbd">⌘K</span>
                  </button>
                  <button
                    type="button"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setCopilotOpen((o) => !o);
                      setActiveMenu(null);
                    }}
                  >
                    <span>🤖 DigiCopilot AI</span>
                  </button>
                  <button
                    type="button"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setPcb3dOpen((o) => !o);
                      setActiveMenu(null);
                    }}
                  >
                    <span>🧊 3D PCB View</span>
                  </button>
                  <button
                    type="button"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setTerminalOpen((o) => !o);
                      setActiveMenu(null);
                    }}
                  >
                    <span>⌘ Interactive Terminal</span>
                    <span className="nav-dropdown-kbd">Ctrl+J</span>
                  </button>
                </div>
              )}
            </div>

            {/* Help Menu */}
            <div className="nav-menu-item">
              <button
                type="button"
                className={`nav-menu-btn ${activeMenu === 'help' ? 'nav-menu-btn--active' : ''}`}
                onClick={() => setActiveMenu((m) => (m === 'help' ? null : 'help'))}
              >
                Help <span className="nav-menu-arrow">▾</span>
              </button>
              {activeMenu === 'help' && (
                <div className="nav-dropdown">
                  <button
                    type="button"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setGalleryOpen(true);
                      setActiveMenu(null);
                    }}
                  >
                    <span>🚀 Examples Showcase</span>
                  </button>
                  <button
                    type="button"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setTourOpen(true);
                      setActiveMenu(null);
                    }}
                  >
                    <span>💡 60-Sec Interactive Guide</span>
                  </button>
                  <button
                    type="button"
                    className="nav-dropdown-item"
                    onClick={() => {
                      setHotkeyCheatsheetOpen(true);
                      setActiveMenu(null);
                    }}
                  >
                    <span>⌨ Keyboard Shortcuts</span>
                    <span className="nav-dropdown-kbd">?</span>
                  </button>
                </div>
              )}
            </div>
          </nav>
        </div>

        {/* Center Section: Transport Controls & Status */}
        <div className="navbar-center">
          <div className="nav-transport-pill">
            <button
              type="button"
              className={`nav-transport-btn ${isSimulating ? 'nav-transport-btn--run' : 'nav-transport-btn--paused'}`}
              onClick={() => setIsSimulating((sim) => !sim)}
              title="Run / Pause Simulation (Space)"
            >
              {isSimulating ? (
                <>
                  <span className="pulse-dot" />
                  <span>Running</span>
                </>
              ) : (
                <>
                  <span>▶</span>
                  <span>Run</span>
                </>
              )}
            </button>
            <button
              type="button"
              className="nav-transport-btn"
              onClick={() => setIsSimulating(false)}
              title="Single Time Step"
            >
              ⏭
            </button>
            <button
              type="button"
              className="nav-transport-btn"
              onClick={() => {
                setIsSimulating(false);
              }}
              title="Reset Simulation (↺)"
            >
              ↺
            </button>
          </div>

          <div className="stat-chip" title="Canvas Elements Count">
            <span>{nodes.length} Nodes</span>
          </div>

          {activeProject && (
            <span className="stat-chip project-chip" title="Active Project">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
              {activeProject.name}
              <button
                className="logout-btn"
                onClick={closeProject}
                title="Close Project"
              >
                ✕
              </button>
            </span>
          )}
        </div>

        {/* Right Section: Quick Triggers, Export Dropdown, and User Profile */}
        <div className="navbar-right">
          <button
            type="button"
            className="nav-tool-btn nav-tool-btn--showcase"
            onClick={() => setGalleryOpen(true)}
            title="Explore 1-click playable example circuits"
          >
            🚀 Examples
          </button>

          <button
            type="button"
            className={`nav-tool-btn nav-tool-btn--copilot ${copilotOpen ? 'nav-tool-btn--active' : ''}`}
            onClick={() => setCopilotOpen((o) => !o)}
            title="DigiCopilot AI EDA Assistant"
          >
            🤖 DigiCopilot
          </button>

          <button
            type="button"
            className={`nav-tool-btn ${pcb3dOpen ? 'nav-tool-btn--active' : ''}`}
            onClick={() => setPcb3dOpen((o) => !o)}
            title="Interactive 3D PCB View"
          >
            🧊 3D PCB
          </button>

          <button
            type="button"
            className="nav-tool-btn"
            onClick={() => setCommandPaletteOpen(true)}
            title="Command Palette (⌘K / Ctrl+K)"
          >
            ⌘K
          </button>

          <div className="nav-divider" />

          {/* Export Dropdown on Side */}
          <div className="nav-export-wrap" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="nav-export-btn"
              onClick={() => setExportDropdownOpen((o) => !o)}
              title="Export Circuit Netlists and Manufacturing Files"
            >
              <span>Export</span>
              <span className="nav-menu-arrow">▾</span>
            </button>
            {exportDropdownOpen && (
              <div className="nav-dropdown" style={{ right: 0, left: 'auto' }}>
                <button
                  type="button"
                  className="nav-dropdown-item"
                  onClick={handleNetlistExport}
                >
                  <span>📄 Export JSON Netlist</span>
                </button>
                <button
                  type="button"
                  className="nav-dropdown-item"
                  onClick={handleSpiceExport}
                >
                  <span>⚡ Export SPICE (.cir)</span>
                </button>
                <button
                  type="button"
                  className="nav-dropdown-item"
                  onClick={handleSpectreExport}
                >
                  <span>🏛 Export Cadence Spectre</span>
                </button>
                <div className="nav-dropdown-sep" />
                <button
                  type="button"
                  className="nav-dropdown-item"
                  onClick={handleGerberExport}
                >
                  <span>🖨 Export Gerber RS-274X</span>
                </button>
              </div>
            )}
          </div>

          <div className="nav-divider" />

          {/* User Auth Section */}
          <div className="nav-user-section">
            {user ? (
              <div className="user-chip-logged">
                <span>👤 {user.email}</span>
                <button className="btn-logout-link" onClick={logout} title="Log Out">
                  Sign out
                </button>
              </div>
            ) : isGuest ? (
              <div className="user-chip-guest">
                <span>👤 Guest</span>
                <button className="btn-login-accent" onClick={logout} title="Log in to your account">
                  Log in
                </button>
              </div>
            ) : null}
          </div>

          <input
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            id="header-image-upload"
            style={{ display: 'none' }}
          />
        </div>
      </header>      {cameraOpen && (
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
      {photoReview && (
        <PhotoReview
          result={photoReview}
          libraryApi={libraryApi}
          onConfirm={placePhotoComponents}
          onCancel={() => setPhotoReview(null)}
        />
      )}
      {galleryOpen && (
        <CircuitGalleryModal
          open={galleryOpen}
          onClose={() => setGalleryOpen(false)}
          onLoadCircuit={handleLoadSampleCircuit}
        />
      )}
      {tourOpen && (
        <InteractiveTourModal
          open={tourOpen}
          onClose={() => setTourOpen(false)}
          onOpenGallery={() => {
            setTourOpen(false);
            setGalleryOpen(true);
          }}
        />
      )}
      <CommandPaletteModal
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onAddComponent={(type, label, extra) => addNode(type, label, undefined, extra)}
        onAddHardwareNode={addHardwareNode}
        onSwitchPDK={handleSwitchPDK}
        onRunSimulation={() => setIsSimulating(true)}
        onStepSimulation={() => {
          setIsSimulating(false);
          setSimTime((t) => t + 0.1);
        }}
        onResetSimulation={() => {
          setNodes((nds) =>
            nds.map((n) => ({
              ...n,
              data: {
                ...n.data,
                value: 0,
                current: 0,
                voltageDrop: 0,
                brightness: 0,
              },
            }))
          );
        }}
        onOpenPcb3D={() => setPcb3dOpen(true)}
        onOpenCopilot={() => setCopilotOpen(true)}
        onExportSpice={handleSpiceExport}
        onExportGerber={handleGerberExport}
        onExportJson={handleNetlistExport}
        onToggleTerminal={() => setTerminalOpen((open) => !open)}
        onToggleWireMode={() => setWireMode((wm) => !wm)}
        onToggleProbeMode={() => setProbeMode((pm) => !pm)}
        onDrillDown={() => {
          const subckt = nodes.find((n) => n.selected && n.type === 'subckt');
          if (subckt) {
            handleDrillDown(subckt.data.cellName || 'INVERTER', subckt.data.params || {});
          }
        }}
        onPopHierarchy={handlePopHierarchy}
        onFitView={() => rfInstance?.fitView({ padding: 0.15 })}
        onClearCanvas={clearCanvas}
        onOpenHotkeyCheatsheet={() => setHotkeyCheatsheetOpen(true)}
        libraryComponents={libraryComponents}
        activeTechNode={activeTechNode}
      />
      <HotkeyCheatsheetModal
        open={hotkeyCheatsheetOpen}
        onClose={() => setHotkeyCheatsheetOpen(false)}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        onToggleSimulation={() => setIsSimulating((sim) => !sim)}
        onToggleWireMode={() => setWireMode((wm) => !wm)}
        onToggleProbeMode={() => setProbeMode((pm) => !pm)}
        onUndo={handleUndo}
        onPopHierarchy={handlePopHierarchy}
        onToggleTerminal={() => setTerminalOpen((open) => !open)}
      />
      <HotkeyFloatingTrigger onClick={() => setHotkeyCheatsheetOpen(true)} />
      <div className="content-wrapper">
        <Sidebar
          sidebarOpen={sidebarOpen}
          sidebarPinned={sidebarPinned}
          sidebarPeek={sidebarPeek}
          sidebarWidth={sidebarWidth}
          sidebarView={sidebarView}
          setSidebarView={setSidebarView}
          setSidebarPinned={setSidebarPinned}
          setSidebarPeek={setSidebarPeek}
          setSidebarOpen={setSidebarOpen}
          isTouch={isTouch}
          holdSidebarPeek={holdSidebarPeek}
          releaseSidebarPeek={releaseSidebarPeek}
          onPaletteDragStart={onPaletteDragStart}
          addNode={addNode}
          analogPalette={ANALOG_PALETTE}
          gatePalette={GATE_PALETTE}
          handleImageUpload={handleImageUpload}
          setCameraOpen={setCameraOpen}
          sampleImages={sampleImages}
          handleSampleImageSelect={handleSampleImageSelect}
          clearCanvas={clearCanvas}
          startSidebarResize={startSidebarResize}
        />
        <div className="canvas-column">
          {hierarchyStack.length > 0 && (
            <div
              className="hierarchy-breadcrumb-bar"
              style={{
                padding: '6px 16px',
                background: 'rgba(15, 23, 42, 0.96)',
                borderBottom: '1px solid rgba(129, 140, 248, 0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                zIndex: 20,
                fontSize: '0.8rem',
                color: '#c7d2fe',
              }}
            >
              <button
                onClick={handlePopHierarchy}
                className="btn"
                style={{
                  padding: '3px 10px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                ← Pop to Parent
              </button>
              <span style={{ color: '#94a3b8' }}>Hierarchy: Root</span>
              {hierarchyStack.map((item, idx) => (
                <React.Fragment key={idx}>
                  <span style={{ color: '#64748b' }}>&gt;</span>
                  <span style={{ fontWeight: 600, color: '#38bdf8' }}>{item.label}</span>
                </React.Fragment>
              ))}
            </div>
          )}
          <CircuitHealthBar
            nodes={nodes}
            edges={edges}
            onAutoFix={(fixedNodes, fixedEdges) => {
              setNodes(fixedNodes);
              setEdges(fixedEdges);
            }}
          />
        <div
          className="reactflow-wrapper"
          onDrop={onCanvasDrop}
          onDragOver={onCanvasDragOver}
          onTouchStart={isTouch ? onWrapperTouchStart : undefined}
          onTouchMove={isTouch ? cancelLongPress : undefined}
          onTouchEnd={isTouch ? cancelLongPress : undefined}
          style={{ position: 'relative' }}
        >
          <FalstadFlowOverlay nodes={nodes} edges={edges} />
          <InteractiveProbeTooltip nodes={nodes} edges={edges} />
          <DigiCopilotPanel
            open={copilotOpen}
            onClose={() => setCopilotOpen(false)}
            nodes={nodes}
            edges={edges}
            onApplySchematic={(newNodes, newEdges) => {
              setNodes(newNodes);
              setEdges(newEdges);
            }}
          />
          <Pcb3DViewer
            open={pcb3dOpen}
            onClose={() => setPcb3dOpen(false)}
            nodes={nodes}
            edges={edges}
          />
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
          {selectedNodes.length === 1 && (
            <InspectorPanel
              node={selectedNodes[0]}
              updateNodeData={updateNodeData}
              onDelete={deleteSelection}
            />
          )}
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
            onNodeDoubleClick={(_, node) => {
              setSelectedPropNode(node as DigiNode);
              setPropModalOpen(true);
            }}
            // Loose mode lets wires land on the stacked target+source handle
            // pairs used by analog terminals and hardware pins (bidirectional).
            connectionMode={ConnectionMode.Loose}
            fitView
            minZoom={0.02}
            maxZoom={10.0}
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
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="rgba(255, 255, 255, 0.2)" />
          </ReactFlow>
        </div>
        <ComponentPropertiesModal
          open={propModalOpen}
          node={selectedPropNode}
          onClose={() => setPropModalOpen(false)}
          onUpdateNodeData={(nodeId, updatedData) => {
            updateNodeData(nodeId, updatedData);
            setSelectedPropNode((prev) =>
              prev && prev.id === nodeId
                ? { ...prev, data: { ...prev.data, ...updatedData } }
                : prev
            );
          }}
        />
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
