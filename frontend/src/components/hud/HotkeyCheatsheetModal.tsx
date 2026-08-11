/**
 * @file HotkeyCheatsheetModal.tsx
 * @description Interactive Hotkey and Keyboard Shortcuts Cheatsheet modal for DigiSim.
 * Accessible globally via '?' key (Shift+/) or the floating bottom-right helper button.
 * Details canvas editing shortcuts, simulation controls, hierarchy drill-down/pop,
 * command palette, wire/probe modes, and undo/redo operations.
 */

import React, { useEffect, useMemo, useState } from 'react';
import './HotkeyCheatsheetModal.css';

export interface HotkeyEntry {
  id: string;
  category: 'General & Palette' | 'Simulation' | 'Canvas & Editing' | 'Hierarchy & Navigation';
  keys: string[];
  label: string;
  description: string;
  actionText?: string;
  onTrigger?: () => void;
}

export interface HotkeyCheatsheetModalProps {
  open: boolean;
  onClose: () => void;
  onOpenCommandPalette?: () => void;
  onToggleSimulation?: () => void;
  onToggleWireMode?: () => void;
  onToggleProbeMode?: () => void;
  onUndo?: () => void;
  onPopHierarchy?: () => void;
  onToggleTerminal?: () => void;
}

export function HotkeyCheatsheetModal({
  open,
  onClose,
  onOpenCommandPalette,
  onToggleSimulation,
  onToggleWireMode,
  onToggleProbeMode,
  onUndo,
  onPopHierarchy,
  onToggleTerminal,
}: HotkeyCheatsheetModalProps): React.ReactElement | null {
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [search, setSearch] = useState<string>('');

  const isMac = useMemo(() => {
    return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  }, []);

  const cmdKey = isMac ? '⌘' : 'Ctrl';

  useEffect(() => {
    if (open) {
      setSearch('');
      setFilterCategory('all');
    }
  }, [open]);

  // Handle ESC inside the cheatsheet modal
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const hotkeys = useMemo<HotkeyEntry[]>(() => {
    return [
      // 1. General & Palette
      {
        id: 'hotkey-palette',
        category: 'General & Palette',
        keys: [cmdKey, 'K'],
        label: 'Command Palette',
        description: 'Instant fuzzy search for all components, PDK process kits, and quick actions',
        actionText: 'Open Palette',
        onTrigger: () => {
          onClose();
          onOpenCommandPalette?.();
        },
      },
      {
        id: 'hotkey-help',
        category: 'General & Palette',
        keys: ['?'],
        label: 'Hotkey Cheatsheet',
        description: 'Toggle this keyboard shortcut helper anytime',
      },
      {
        id: 'hotkey-terminal',
        category: 'General & Palette',
        keys: [cmdKey, 'J'],
        label: 'Toggle Terminal',
        description: 'Open or close the interactive bottom terminal panel',
        actionText: 'Toggle Terminal',
        onTrigger: () => {
          onClose();
          onToggleTerminal?.();
        },
      },

      // 2. Simulation Controls
      {
        id: 'hotkey-sim-toggle',
        category: 'Simulation',
        keys: ['Space'],
        label: 'Run / Pause Simulation',
        description: 'Start, pause, or resume deterministic logic and analog MNA matrix solve',
        actionText: 'Toggle Simulation',
        onTrigger: () => {
          onClose();
          onToggleSimulation?.();
        },
      },
      {
        id: 'hotkey-sim-step',
        category: 'Simulation',
        keys: ['S'],
        label: 'Single Step Clock',
        description: 'Advance time-dependent clocks and blinking components by one tick',
      },
      {
        id: 'hotkey-sim-reset',
        category: 'Simulation',
        keys: ['R'],
        label: 'Reset Circuit State',
        description: 'Reset all node voltages, switch states, and logic levels to initial values',
      },

      // 3. Canvas Editing & Tools
      {
        id: 'hotkey-wire-mode',
        category: 'Canvas & Editing',
        keys: ['W'],
        label: 'Wire Mode',
        description: 'Toggle schematic wire routing and connection assist mode',
        actionText: 'Toggle Wire Mode',
        onTrigger: () => {
          onClose();
          onToggleWireMode?.();
        },
      },
      {
        id: 'hotkey-probe-mode',
        category: 'Canvas & Editing',
        keys: ['P'],
        label: 'Probe Mode / Inspector',
        description: 'Inspect live voltage, current, and operating regions on nodes and pins',
        actionText: 'Toggle Probe',
        onTrigger: () => {
          onClose();
          onToggleProbeMode?.();
        },
      },
      {
        id: 'hotkey-delete',
        category: 'Canvas & Editing',
        keys: ['Delete', 'Backspace'],
        label: 'Remove Selected',
        description: 'Delete highlighted components, subckts, or wire connections',
      },
      {
        id: 'hotkey-undo',
        category: 'Canvas & Editing',
        keys: [cmdKey, 'Z'],
        label: 'Undo Action',
        description: 'Revert the most recent canvas node/edge placement or deletion',
        actionText: 'Undo',
        onTrigger: () => {
          onClose();
          onUndo?.();
        },
      },
      {
        id: 'hotkey-duplicate',
        category: 'Canvas & Editing',
        keys: [cmdKey, 'D'],
        label: 'Duplicate Selection',
        description: 'Clone selected gates and internal wiring with offset',
      },
      {
        id: 'hotkey-multiselect',
        category: 'Canvas & Editing',
        keys: ['Shift', '+ Drag'],
        label: 'Box Multi-Selection',
        description: 'Draw a selection marquee to group multiple components and wires',
      },

      // 4. Hierarchy & Navigation
      {
        id: 'hotkey-drilldown',
        category: 'Hierarchy & Navigation',
        keys: ['Shift', '+ Double Click'],
        label: 'Drill Down into Sub-Circuit',
        description: 'Push into a subcircuit block (e.g. INVERTER, NAND2) to view and edit its inner schematic',
      },
      {
        id: 'hotkey-pophierarchy',
        category: 'Hierarchy & Navigation',
        keys: ['Esc'],
        label: 'Pop Hierarchy',
        description: 'Pop up from sub-circuit schematic back to the parent circuit sheet',
        actionText: 'Pop Hierarchy',
        onTrigger: () => {
          onClose();
          onPopHierarchy?.();
        },
      },
      {
        id: 'hotkey-pan-canvas',
        category: 'Hierarchy & Navigation',
        keys: ['Right Click / Middle Drag'],
        label: 'Pan Canvas',
        description: 'Move smoothly across the schematic canvas',
      },
      {
        id: 'hotkey-zoom-canvas',
        category: 'Hierarchy & Navigation',
        keys: ['Scroll / Pinch'],
        label: 'Zoom In / Out',
        description: 'Adjust canvas magnification from 20% to 250%',
      },
    ];
  }, [cmdKey, onClose, onOpenCommandPalette, onToggleSimulation, onToggleWireMode, onToggleProbeMode, onUndo, onPopHierarchy, onToggleTerminal]);

  const categories = ['all', 'General & Palette', 'Simulation', 'Canvas & Editing', 'Hierarchy & Navigation'];

  const filteredHotkeys = useMemo(() => {
    return hotkeys.filter((item) => {
      const matchesCategory = filterCategory === 'all' || item.category === filterCategory;
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.keys.some((k) => k.toLowerCase().includes(q)) ||
        item.category.toLowerCase().includes(q);

      return matchesCategory && matchesSearch;
    });
  }, [hotkeys, filterCategory, search]);

  if (!open) return null;

  return (
    <div className="hotkey-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Keyboard Shortcuts Cheatsheet">
      <div className="hotkey-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="hotkey-modal-head">
          <div className="hotkey-head-title">
            <span className="hotkey-head-icon">⌨️</span>
            <div>
              <h2>DigiSim Keyboard Shortcuts & Ergonomics</h2>
              <p>Master quick hotkeys for rapid circuit design, simulation, and hierarchy</p>
            </div>
          </div>
          <button className="hotkey-close-btn" onClick={onClose} aria-label="Close Cheatsheet">
            ✕
          </button>
        </div>

        {/* Search & Category Filter Bar */}
        <div className="hotkey-modal-filter-bar">
          <div className="hotkey-search-box">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search shortcuts... (e.g. Wire, Space, Sub-Circuit, Undo)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="hotkey-search-clear" onClick={() => setSearch('')}>
                ✕
              </button>
            )}
          </div>
          <div className="hotkey-category-tabs">
            {categories.map((cat) => (
              <button
                key={cat}
                className={`hotkey-tab ${filterCategory === cat ? 'hotkey-tab--active' : ''}`}
                onClick={() => setFilterCategory(cat)}
              >
                {cat === 'all' ? 'All Shortcuts' : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Shortcuts List */}
        <div className="hotkey-modal-body">
          {filteredHotkeys.length === 0 ? (
            <div className="hotkey-empty-state">
              <span>🔍</span>
              <p>No shortcuts found matching &ldquo;{search}&rdquo;</p>
            </div>
          ) : (
            <div className="hotkey-grid">
              {filteredHotkeys.map((hk) => (
                <div key={hk.id} className="hotkey-card">
                  <div className="hotkey-card-header">
                    <span className="hotkey-card-label">{hk.label}</span>
                    <span className="hotkey-card-category">{hk.category}</span>
                  </div>
                  <div className="hotkey-card-desc">{hk.description}</div>
                  <div className="hotkey-card-bottom">
                    <div className="hotkey-keys-wrap">
                      {hk.keys.map((k, i) => (
                        <kbd key={i} className="hotkey-kbd">
                          {k}
                        </kbd>
                      ))}
                    </div>
                    {hk.onTrigger && (
                      <button
                        className="hotkey-try-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          hk.onTrigger?.();
                        }}
                      >
                        {hk.actionText ?? 'Try'} ›
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="hotkey-modal-footer">
          <span>
            💡 Pro Tip: Press <kbd className="hotkey-kbd-mini">{cmdKey}+K</kbd> anywhere to open the universal Command Palette!
          </span>
          <button className="btn hotkey-footer-done" onClick={onClose}>
            Got it (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Floating help button positioned bottom-right on the canvas.
 */
export function HotkeyFloatingTrigger({ onClick }: { onClick: () => void }): React.ReactElement {
  return (
    <button
      className="hotkey-floating-trigger"
      onClick={onClick}
      aria-label="Keyboard Shortcuts Cheatsheet (?)"
      title="Keyboard Shortcuts Cheatsheet (Press ?)"
    >
      <span className="hotkey-trigger-icon">?</span>
      <span className="hotkey-trigger-label">Shortcuts</span>
    </button>
  );
}

export default HotkeyCheatsheetModal;
