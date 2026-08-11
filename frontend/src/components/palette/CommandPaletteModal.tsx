/**
 * @file CommandPaletteModal.tsx
 * @description Power-user Command Palette (Cmd+K / Ctrl+K) modal with fuzzy search.
 * Provides instant canvas placement for all analog/digital/transistor components,
 * one-click PDK technology node switching (180nm, 90nm, 28nm), quick action
 * triggers (Run/Step/Reset, 3D PCB, DigiCopilot AI, SPICE/Gerber export),
 * and keyboard navigation with category groupings.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LibraryComponent, TechNode } from '../../types';
import './CommandPaletteModal.css';

export interface CommandItem {
  id: string;
  title: string;
  category: 'Components' | 'PDK Process Nodes' | 'Simulation' | 'Tools & Views' | 'Canvas Tools' | 'Export & Files' | 'Hierarchy' | 'Help';
  description?: string;
  shortcut?: string;
  icon?: React.ReactNode;
  keywords?: string;
  onSelect: () => void;
}

export interface CommandPaletteModalProps {
  open: boolean;
  onClose: () => void;
  onAddComponent: (type: string, label: string, extraData?: Record<string, unknown>) => void;
  onAddHardwareNode?: (component: LibraryComponent) => void;
  onSwitchPDK: (node: TechNode) => void;
  onRunSimulation: () => void;
  onStepSimulation: () => void;
  onResetSimulation: () => void;
  onOpenPcb3D: () => void;
  onOpenCopilot: () => void;
  onExportSpice: () => void;
  onExportGerber: () => void;
  onExportJson: () => void;
  onToggleTerminal: () => void;
  onToggleWireMode?: () => void;
  onToggleProbeMode?: () => void;
  onDrillDown?: () => void;
  onPopHierarchy?: () => void;
  onFitView?: () => void;
  onClearCanvas?: () => void;
  onOpenHotkeyCheatsheet?: () => void;
  libraryComponents?: LibraryComponent[];
  activeTechNode?: TechNode;
}

/**
 * Fuzzy search match scoring function.
 * Matches all chars of query in order within target string with bonus for contiguous runs and word starts.
 */
export function fuzzyScore(query: string, target: string): { matches: boolean; score: number } {
  const q = query.trim().toLowerCase();
  const t = target.toLowerCase();

  if (!q) return { matches: true, score: 0 };
  if (t === q) return { matches: true, score: 1000 };
  if (t.startsWith(q)) return { matches: true, score: 500 + (q.length / t.length) * 100 };
  if (t.includes(q)) return { matches: true, score: 300 + (q.length / t.length) * 50 };

  let qIdx = 0;
  let tIdx = 0;
  let score = 0;
  let consecutive = 0;
  const matchedIndices: number[] = [];

  while (qIdx < q.length && tIdx < t.length) {
    if (q[qIdx] === t[tIdx]) {
      matchedIndices.push(tIdx);
      qIdx++;
      consecutive++;
      score += 10 + consecutive * 5;
      // Bonus if it is at the beginning of a word
      if (tIdx === 0 || t[tIdx - 1] === ' ' || t[tIdx - 1] === '-' || t[tIdx - 1] === '_') {
        score += 25;
      }
    } else {
      consecutive = 0;
    }
    tIdx++;
  }

  if (qIdx < q.length) {
    return { matches: false, score: 0 };
  }

  const span = matchedIndices[matchedIndices.length - 1] - matchedIndices[0] + 1;
  const coverage = q.length / span;
  if (coverage < 0.25 && !t.includes(q)) {
    return { matches: false, score: 0 };
  }

  score += coverage * 50;
  return { matches: true, score };
}

export function CommandPaletteModal({
  open,
  onClose,
  onAddComponent,
  onAddHardwareNode,
  onSwitchPDK,
  onRunSimulation,
  onStepSimulation,
  onResetSimulation,
  onOpenPcb3D,
  onOpenCopilot,
  onExportSpice,
  onExportGerber,
  onExportJson,
  onToggleTerminal,
  onToggleWireMode,
  onToggleProbeMode,
  onDrillDown,
  onPopHierarchy,
  onFitView,
  onClearCanvas,
  onOpenHotkeyCheatsheet,
  libraryComponents = [],
  activeTechNode = '180nm',
}: CommandPaletteModalProps): React.ReactElement | null {
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setSearch('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Build full registry of commands
  const allCommands = useMemo<CommandItem[]>(() => {
    const commands: CommandItem[] = [
      // --- 1. ALL CIRCUIT COMPONENTS ---
      {
        id: 'comp-nmos',
        title: 'NMOS Transistor',
        category: 'Components',
        description: '4-Terminal NMOS MOSFET Transistor (BSIM Model)',
        keywords: 'nmos fet mosfet transistor switch silicon active',
        onSelect: () => onAddComponent('nmos', 'NMOS', { techNode: activeTechNode }),
      },
      {
        id: 'comp-pmos',
        title: 'PMOS Transistor',
        category: 'Components',
        description: '4-Terminal PMOS MOSFET Transistor (BSIM Model)',
        keywords: 'pmos fet mosfet transistor pullup silicon active',
        onSelect: () => onAddComponent('pmos', 'PMOS', { techNode: activeTechNode }),
      },
      {
        id: 'comp-and',
        title: 'AND Gate',
        category: 'Components',
        description: '2-Input Logic AND Gate (Conjunction)',
        keywords: 'and gate logic digital boolean conjunction',
        onSelect: () => onAddComponent('andGate', 'AND Gate'),
      },
      {
        id: 'comp-or',
        title: 'OR Gate',
        category: 'Components',
        description: '2-Input Logic OR Gate (Disjunction)',
        keywords: 'or gate logic digital boolean disjunction',
        onSelect: () => onAddComponent('orGate', 'OR Gate'),
      },
      {
        id: 'comp-not',
        title: 'NOT Gate (Inverter)',
        category: 'Components',
        description: 'Logic Inverter Gate (Negation)',
        keywords: 'not inv inverter gate logic digital boolean',
        onSelect: () => onAddComponent('notGate', 'NOT Gate'),
      },
      {
        id: 'comp-nand',
        title: 'NAND Gate',
        category: 'Components',
        description: '2-Input Universal NAND Gate',
        keywords: 'nand universal gate logic digital boolean',
        onSelect: () => onAddComponent('nandGate', 'NAND Gate'),
      },
      {
        id: 'comp-nor',
        title: 'NOR Gate',
        category: 'Components',
        description: '2-Input Universal NOR Gate',
        keywords: 'nor universal gate logic digital boolean',
        onSelect: () => onAddComponent('norGate', 'NOR Gate'),
      },
      {
        id: 'comp-xor',
        title: 'XOR Gate',
        category: 'Components',
        description: '2-Input Exclusive OR Gate (Parity / Adder)',
        keywords: 'xor gate exclusive or logic digital parity',
        onSelect: () => onAddComponent('xorGate', 'XOR Gate'),
      },
      {
        id: 'comp-xnor',
        title: 'XNOR Gate',
        category: 'Components',
        description: '2-Input Exclusive NOR Gate (Equivalence)',
        keywords: 'xnor gate equivalence logic digital boolean',
        onSelect: () => onAddComponent('xnorGate', 'XNOR Gate'),
      },
      {
        id: 'comp-subckt',
        title: 'Sub-Circuit Block',
        category: 'Components',
        description: 'Hierarchical OpenAccess Subcircuit Module',
        keywords: 'subckt subcircuit block cell hierarchy module openaccess',
        onSelect: () => onAddComponent('subckt', 'Sub-Circuit Block'),
      },
      {
        id: 'comp-resistor',
        title: 'Resistor',
        category: 'Components',
        description: 'Linear Passive Resistor (220Ω Default)',
        keywords: 'resistor r ohm passive analog load divider',
        onSelect: () => onAddComponent('resistor', 'Resistor', { param: 220 }),
      },
      {
        id: 'comp-capacitor',
        title: 'Capacitor',
        category: 'Components',
        description: 'Passive Capacitor Component (100nF)',
        keywords: 'capacitor cap c farad filter passive analog timing',
        onSelect: () => onAddComponent('resistor', 'Capacitor 100nF', { param: 100 }),
      },
      {
        id: 'comp-clock',
        title: 'Clock Source',
        category: 'Components',
        description: '1kHz Digital Clock Pulse Generator',
        keywords: 'clock clk pulse oscillator square wave generator input',
        onSelect: () => onAddComponent('input', 'Clock 1kHz', { value: 1 }),
      },
      {
        id: 'comp-vsource',
        title: 'DC Voltage Source',
        category: 'Components',
        description: 'DC Power Supply Source (5V Default)',
        keywords: 'vsource dc voltage source battery supply vdd power 5v',
        onSelect: () => onAddComponent('vsource', 'Voltage Source', { param: 5 }),
      },
      {
        id: 'comp-ground',
        title: 'Ground Reference (GND)',
        category: 'Components',
        description: '0V Circuit Ground Reference Node',
        keywords: 'ground gnd 0v vss reference earth zero',
        onSelect: () => onAddComponent('ground', 'Ground'),
      },
      {
        id: 'comp-led',
        title: 'LED Indicator',
        category: 'Components',
        description: 'Light Emitting Diode with live glow calculation',
        keywords: 'led diode light indicator output visual glow',
        onSelect: () => onAddComponent('led', 'LED'),
      },
      {
        id: 'comp-switch',
        title: 'SPST Switch',
        category: 'Components',
        description: 'Single-Pole Single-Throw Toggle Switch',
        keywords: 'switch analog toggle mechanical contact button',
        onSelect: () => onAddComponent('analogSwitch', 'Switch'),
      },
      {
        id: 'comp-potentiometer',
        title: 'Potentiometer',
        category: 'Components',
        description: '10kΩ Adjustable Variable Resistor / Wiper',
        keywords: 'potentiometer pot variable resistor wiper rheostat 10k',
        onSelect: () => onAddComponent('potentiometer', 'Potentiometer', { param: 10000, percent: 50 }),
      },
      {
        id: 'comp-input',
        title: 'Logic Input Switch',
        category: 'Components',
        description: 'Digital Logic Level Switch (0 / 1)',
        keywords: 'input switch logic digital bit toggle source',
        onSelect: () => onAddComponent('input', 'Input'),
      },
      {
        id: 'comp-output',
        title: 'Logic Output Probe',
        category: 'Components',
        description: 'Digital Logic Output State Monitor',
        keywords: 'output probe led meter indicator digital state',
        onSelect: () => onAddComponent('output', 'Output'),
      },

      // --- 2. PDK TECHNOLOGY SWITCHER COMMANDS ---
      {
        id: 'pdk-180nm',
        title: 'Switch to 180nm CMOS',
        category: 'PDK Process Nodes',
        description: `Set active process kit to BSIM3v3 180nm CMOS (Vdd=1.8V)${activeTechNode === '180nm' ? ' • [CURRENT]' : ''}`,
        keywords: 'switch pdk 180nm 180 cmos bsim3 bsim3v3 process node technology',
        onSelect: () => onSwitchPDK('180nm'),
      },
      {
        id: 'pdk-90nm',
        title: 'Switch to 90nm CMOS',
        category: 'PDK Process Nodes',
        description: `Set active process kit to BSIM4 90nm CMOS (Vdd=1.2V)${activeTechNode === '90nm' ? ' • [CURRENT]' : ''}`,
        keywords: 'switch pdk 90nm 90 cmos bsim4 process node technology',
        onSelect: () => onSwitchPDK('90nm'),
      },
      {
        id: 'pdk-28nm',
        title: 'Switch to 28nm HKMG',
        category: 'PDK Process Nodes',
        description: `Set active process kit to BSIM-IMG 28nm High-k Metal Gate (Vdd=0.9V)${activeTechNode === '28nm' ? ' • [CURRENT]' : ''}`,
        keywords: 'switch pdk 28nm 28 hkmg high-k metal gate bsim-img advanced node',
        onSelect: () => onSwitchPDK('28nm'),
      },

      // --- 3. QUICK ACTIONS & SIMULATION ---
      {
        id: 'action-run',
        title: 'Run Simulation',
        category: 'Simulation',
        description: 'Start or resume live digital logic and analog MNA solver',
        shortcut: 'Space',
        keywords: 'run simulation start play solve resume live',
        onSelect: onRunSimulation,
      },
      {
        id: 'action-step',
        title: 'Step',
        category: 'Simulation',
        description: 'Advance simulation by one clock cycle / step',
        shortcut: 'S',
        keywords: 'step simulation clock pulse tick advance',
        onSelect: onStepSimulation,
      },
      {
        id: 'action-reset',
        title: 'Reset',
        category: 'Simulation',
        description: 'Reset all node voltages, flip-flops, and logic states to initial',
        shortcut: 'R',
        keywords: 'reset clear zero restart initial state',
        onSelect: onResetSimulation,
      },
      {
        id: 'action-pcb3d',
        title: 'Open 3D PCB View',
        category: 'Tools & Views',
        description: 'Launch interactive 3D WebGL multi-layer PCB visualizer',
        keywords: 'open 3d pcb view board webgl layout cad viewer',
        onSelect: onOpenPcb3D,
      },
      {
        id: 'action-copilot',
        title: 'Open DigiCopilot AI',
        category: 'Tools & Views',
        description: 'Launch DigiCopilot AI EDA assistant for synthesis and debugging',
        keywords: 'open digicopilot ai copilot assistant eda synthesis chat generate',
        onSelect: onOpenCopilot,
      },
      {
        id: 'action-export-spice',
        title: 'Export SPICE Netlist',
        category: 'Export & Files',
        description: 'Download standard .cir SPICE netlist with BSIM model cards',
        keywords: 'export spice netlist cir simulation spectre cadence ngspice',
        onSelect: onExportSpice,
      },
      {
        id: 'action-export-gerber',
        title: 'Export Gerber',
        category: 'Export & Files',
        description: 'Download standard RS-274X PCB Gerber top copper layer (.gbr)',
        keywords: 'export gerber gbr pcb cam manufacturing fabrication drill layout',
        onSelect: onExportGerber,
      },
      {
        id: 'action-export-json',
        title: 'Export JSON Netlist',
        category: 'Export & Files',
        description: 'Export canvas schematic as canonical DigiSim JSON file',
        keywords: 'export json netlist circuit file download save',
        onSelect: onExportJson,
      },
      {
        id: 'action-terminal',
        title: 'Toggle Terminal',
        category: 'Tools & Views',
        description: 'Show or hide bottom interactive terminal panel',
        shortcut: '⌘J',
        keywords: 'toggle terminal console cli logs python bash',
        onSelect: onToggleTerminal,
      },
      {
        id: 'action-wire-mode',
        title: 'Toggle Wire Mode',
        category: 'Canvas Tools',
        description: 'Activate schematic wire routing mode',
        shortcut: 'W',
        keywords: 'wire mode connect draw route line trace',
        onSelect: () => onToggleWireMode?.(),
      },
      {
        id: 'action-probe-mode',
        title: 'Toggle Probe Mode',
        category: 'Canvas Tools',
        description: 'Inspect live voltages and currents on schematic nodes',
        shortcut: 'P',
        keywords: 'probe mode inspector voltage current multimeter measurement',
        onSelect: () => onToggleProbeMode?.(),
      },
      {
        id: 'action-drilldown',
        title: 'Drill Down into Sub-circuit',
        category: 'Hierarchy',
        description: 'Push canvas view into selected subcircuit schematic',
        shortcut: 'Shift+2xClick',
        keywords: 'drill down subcircuit subckt hierarchy push enter inner schematic',
        onSelect: () => onDrillDown?.(),
      },
      {
        id: 'action-pophierarchy',
        title: 'Pop Hierarchy',
        category: 'Hierarchy',
        description: 'Pop up to parent circuit hierarchy',
        shortcut: 'Esc',
        keywords: 'pop hierarchy parent exit up top return',
        onSelect: () => onPopHierarchy?.(),
      },
      {
        id: 'action-fit-view',
        title: 'Fit Canvas View',
        category: 'Canvas Tools',
        description: 'Center and fit all components in viewport',
        keywords: 'fit view zoom center canvas reset view',
        onSelect: () => onFitView?.(),
      },
      {
        id: 'action-clear-canvas',
        title: 'Clear Canvas',
        category: 'Canvas Tools',
        description: 'Remove all components and wires from canvas',
        keywords: 'clear delete all reset canvas blank new',
        onSelect: () => onClearCanvas?.(),
      },
      {
        id: 'action-hotkeys',
        title: 'Keyboard Shortcuts Cheatsheet',
        category: 'Help',
        description: 'View all keyboard shortcuts and canvas ergonomics',
        shortcut: '?',
        keywords: 'hotkey hotkeys shortcuts cheatsheet help keyboard keys guide',
        onSelect: () => onOpenHotkeyCheatsheet?.(),
      },
    ];

    // Append any dynamic hardware components from library
    if (onAddHardwareNode && libraryComponents.length > 0) {
      libraryComponents.forEach((comp) => {
        commands.push({
          id: `lib-comp-${comp.id}`,
          title: comp.canonical_name,
          category: 'Components',
          description: `Hardware Part (${comp.category ?? 'IC'}) • ${comp.pin_map.pins.length} pins`,
          keywords: `hardware component library ic ${comp.aliases.join(' ')} ${comp.category ?? ''}`,
          onSelect: () => onAddHardwareNode(comp),
        });
      });
    }

    return commands;
  }, [
    activeTechNode,
    onAddComponent,
    onAddHardwareNode,
    onSwitchPDK,
    onRunSimulation,
    onStepSimulation,
    onResetSimulation,
    onOpenPcb3D,
    onOpenCopilot,
    onExportSpice,
    onExportGerber,
    onExportJson,
    onToggleTerminal,
    onToggleWireMode,
    onToggleProbeMode,
    onDrillDown,
    onPopHierarchy,
    onFitView,
    onClearCanvas,
    onOpenHotkeyCheatsheet,
    libraryComponents,
  ]);

  // Filter commands using fuzzy matching
  const filteredCommands = useMemo(() => {
    const q = search.trim();
    if (!q) return allCommands;

    const scored = allCommands
      .map((cmd) => {
        const titleScore = fuzzyScore(q, cmd.title);
        const catScore = fuzzyScore(q, cmd.category);
        const descScore = cmd.description ? fuzzyScore(q, cmd.description) : { matches: false, score: 0 };
        const shortcutScore = cmd.shortcut ? fuzzyScore(q, cmd.shortcut) : { matches: false, score: 0 };

        let keywordMatch = false;
        let keywordScore = 0;
        if (cmd.keywords) {
          for (const word of cmd.keywords.split(/\s+/)) {
            const ks = fuzzyScore(q, word);
            if (ks.matches) {
              keywordMatch = true;
              keywordScore = Math.max(keywordScore, ks.score);
            }
          }
        }

        const isMatch = titleScore.matches || catScore.matches || descScore.matches || shortcutScore.matches || keywordMatch;
        const totalScore =
          (titleScore.matches ? titleScore.score * 3 : 0) +
          (catScore.matches ? catScore.score * 1.5 : 0) +
          (shortcutScore.matches ? shortcutScore.score * 2 : 0) +
          (descScore.matches ? descScore.score : 0) +
          (keywordMatch ? keywordScore * 1.2 : 0);

        return {
          cmd,
          matches: isMatch,
          score: totalScore,
        };
      })
      .filter((item) => item.matches)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.cmd);

    return scored;
  }, [allCommands, search]);

  // Reset selected index when filtered list shrinks
  useEffect(() => {
    setSelectedIndex((prev) => (prev >= filteredCommands.length ? 0 : prev));
  }, [filteredCommands]);

  // Execute selected command
  const executeCommand = useCallback(
    (cmd: CommandItem) => {
      onClose();
      cmd.onSelect();
    },
    [onClose]
  );

  // Keyboard navigation inside palette
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredCommands.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % Math.max(1, filteredCommands.length));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          executeCommand(filteredCommands[selectedIndex]);
        }
      }
    },
    [filteredCommands, selectedIndex, executeCommand, onClose]
  );

  // Ensure selected item stays in view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector('.cmd-item--selected') as HTMLElement | null;
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!open) return null;

  return (
    <div className="cmd-palette-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Command Palette">
      <div className="cmd-palette-modal" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        {/* Search Header */}
        <div className="cmd-palette-search-box">
          <svg className="cmd-palette-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="cmd-palette-input"
            placeholder="Type a command, component, PDK, or action... (e.g. NMOS, 180nm, SPICE, Gerber)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="cmd-palette-clear-btn" onClick={() => setSearch('')} aria-label="Clear search">
              ✕
            </button>
          )}
          <span className="cmd-palette-badge">ESC to close</span>
        </div>

        {/* Results List */}
        <div className="cmd-palette-list" ref={listRef}>
          {filteredCommands.length === 0 ? (
            <div className="cmd-palette-empty">
              <span className="cmd-empty-icon">🔍</span>
              <p>No matching commands or components for &ldquo;{search}&rdquo;</p>
              <span className="cmd-empty-sub">Try searching &lsquo;NMOS&rsquo;, &lsquo;AND&rsquo;, &lsquo;PDK&rsquo;, &lsquo;SPICE&rsquo;, or &lsquo;Gerber&rsquo;</span>
            </div>
          ) : (
            filteredCommands.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={cmd.id}
                  className={`cmd-item ${isSelected ? 'cmd-item--selected' : ''}`}
                  onClick={() => executeCommand(cmd)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div className="cmd-item-main">
                    <div className="cmd-item-header">
                      <span className="cmd-item-title">{cmd.title}</span>
                      <span className={`cmd-item-category cmd-cat--${cmd.category.toLowerCase().replace(/[^a-z0-9]/g, '')}`}>
                        {cmd.category}
                      </span>
                    </div>
                    {cmd.description && <div className="cmd-item-desc">{cmd.description}</div>}
                  </div>
                  {cmd.shortcut && (
                    <div className="cmd-item-shortcut">
                      <kbd className="cmd-kbd">{cmd.shortcut}</kbd>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Palette Footer */}
        <div className="cmd-palette-footer">
          <span className="cmd-footer-hint">
            <kbd className="cmd-kbd-mini">↑</kbd> <kbd className="cmd-kbd-mini">↓</kbd> to navigate
          </span>
          <span className="cmd-footer-hint">
            <kbd className="cmd-kbd-mini">↵</kbd> to select
          </span>
          <span className="cmd-footer-hint">
            <kbd className="cmd-kbd-mini">ESC</kbd> to dismiss
          </span>
          <span className="cmd-footer-count">{filteredCommands.length} commands</span>
        </div>
      </div>
    </div>
  );
}

export default CommandPaletteModal;
