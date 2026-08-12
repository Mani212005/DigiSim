/**
 * @file Sidebar.tsx
 * @description Cadence Virtuoso-grade Silicon EDA Component Toolbox.
 * Categorized into Silicon Transistors, Passives & Power References, and Digital Standard Cells.
 */

import React, { useState } from 'react';
import './Sidebar.css';
import { GateGlyph } from '../nodes/GateShell';
import SampleImages from './SampleImages';
import { COMPONENT_TOOLTIP_DATA, ComponentTooltipInfo } from './palette/componentTooltipData';
import type { PaletteEntry, SidebarView } from '../types';

interface SidebarProps {
  sidebarOpen: boolean;
  sidebarPinned: boolean;
  sidebarPeek: boolean;
  sidebarWidth: number;
  sidebarView: SidebarView;
  setSidebarView: (view: SidebarView) => void;
  setSidebarPinned: (pinned: boolean) => void;
  setSidebarPeek: (peek: boolean) => void;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isTouch: boolean;
  holdSidebarPeek: () => void;
  releaseSidebarPeek: () => void;

  onPaletteDragStart: (event: React.DragEvent, type: string, label: string) => void;
  addNode: (type: string, label: string) => void;

  analogPalette: { type: string; label: string; name: string; hint: string }[];
  gatePalette: PaletteEntry[];

  handleImageUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  setCameraOpen: (open: boolean) => void;
  sampleImages: string[];
  handleSampleImageSelect: (url: string) => void;
  clearCanvas: () => void;
  startSidebarResize: (event: React.MouseEvent) => void;
}

const Accordion: React.FC<{ title: string; defaultOpen?: boolean; children: React.ReactNode }> = ({
  title,
  defaultOpen = true,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`accordion ${open ? '' : 'collapsed'}`}>
      <div className="accordion-header" onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <svg className="accordion-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div className="accordion-body" style={{ display: open ? '' : 'none' }}>
        {children}
      </div>
    </div>
  );
};

export const ComponentTooltipCard: React.FC<{ info: ComponentTooltipInfo }> = ({ info }) => (
  <div className="component-rich-tooltip" role="tooltip">
    <div className="tooltip-header">
      <span className="tooltip-title">{info.name}</span>
      <span className="tooltip-category">{info.category}</span>
    </div>
    <div className="tooltip-desc">{info.description}</div>
    <div className="tooltip-pins">
      <span className="tooltip-pin-icon">⚡</span>
      <span className="tooltip-pin-text">{info.pins}</span>
    </div>
    {info.formula && (
      <div className="tooltip-formula-box">
        <span className="tooltip-formula-label">Formula:</span>
        <code className="tooltip-formula-code">{info.formula}</code>
      </div>
    )}
    {info.hint && <div className="tooltip-hint">💡 {info.hint}</div>}
  </div>
);

export default function Sidebar({
  sidebarOpen,
  sidebarPinned,
  sidebarPeek,
  sidebarWidth,
  sidebarView,
  setSidebarView,
  setSidebarPinned,
  setSidebarPeek,
  setSidebarOpen,
  isTouch,
  holdSidebarPeek,
  releaseSidebarPeek,
  onPaletteDragStart,
  addNode,
  analogPalette,
  gatePalette,
  handleImageUpload,
  setCameraOpen,
  sampleImages,
  handleSampleImageSelect,
  clearCanvas,
  startSidebarResize,
}: SidebarProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<'silicon' | 'passives' | 'logic'>('silicon');

  return (
    <>
      <button
        className="sidebar-toggle"
        aria-label="Toggle component drawer"
        aria-expanded={sidebarOpen}
        onClick={() => setSidebarOpen((open) => !open)}
      >
        {sidebarOpen ? '✕ Close' : '☰ Silicon Parts'}
      </button>
      {!sidebarPinned && (
        <button
          className="sidebar-reveal-btn"
          aria-label="Show toolbox"
          title="Silicon Toolbox — hover to peek, click to pin"
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
        className={`sidebar glass${sidebarOpen ? ' sidebar--open' : ''}${
          !sidebarPinned && !sidebarPeek ? ' sidebar--collapsed' : ''
        }${!sidebarPinned && sidebarPeek ? ' sidebar--peek' : ''}`}
        style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
        onMouseEnter={!sidebarPinned && !isTouch ? holdSidebarPeek : undefined}
        onMouseLeave={!sidebarPinned && !isTouch ? releaseSidebarPeek : undefined}
      >
        <div className="sidebar-head">
          <span className="sidebar-head__title">Silicon Toolbox</span>
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

        <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden-file-input" id="image-upload-input" />
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleImageUpload}
          className="hidden-file-input"
          id="camera-fallback-input"
        />

        {sidebarView === 'menu' ? (
          <nav className="sidebar-menu" aria-label="Toolbox sections">
            <button className="sidebar-menu-btn" onClick={() => setSidebarView('library')}>
              <span className="sidebar-menu-btn__icon" aria-hidden="true">▦</span>
              <span className="sidebar-menu-btn__text">
                <span className="sidebar-menu-btn__name">Silicon Primitives</span>
                <span className="sidebar-menu-btn__sub">
                  MOSFETs, BJTs, passives & logic gates
                </span>
              </span>
              <span className="sidebar-menu-btn__arrow" aria-hidden="true">›</span>
            </button>
            <button className="sidebar-menu-btn" onClick={() => setSidebarView('vision')}>
              <span className="sidebar-menu-btn__icon" aria-hidden="true">📷</span>
              <span className="sidebar-menu-btn__text">
                <span className="sidebar-menu-btn__name">Vision OCR</span>
                <span className="sidebar-menu-btn__sub">detect circuits from photos</span>
              </span>
              <span className="sidebar-menu-btn__arrow" aria-hidden="true">›</span>
            </button>
          </nav>
        ) : (
          <div className="sidebar-view-head">
            <button
              className="sidebar-back-btn"
              aria-label="Back to toolbox menu"
              onClick={() => setSidebarView('menu')}
            >
              ← Back
            </button>
            <span className="sidebar-view-title">
              {sidebarView === 'library' && 'Silicon Library'}
              {sidebarView === 'vision' && 'Vision OCR'}
            </span>
          </div>
        )}

        {sidebarView === 'library' && (
          <div className="redesigned-library">
            <div className="sidebar-header">
              <div className="segment-control">
                <button
                  className={`segment-tab ${activeTab === 'silicon' ? 'active' : ''}`}
                  onClick={() => setActiveTab('silicon')}
                >
                  Transistors
                </button>
                <button
                  className={`segment-tab ${activeTab === 'passives' ? 'active' : ''}`}
                  onClick={() => setActiveTab('passives')}
                >
                  Passives & Ref
                </button>
                <button
                  className={`segment-tab ${activeTab === 'logic' ? 'active' : ''}`}
                  onClick={() => setActiveTab('logic')}
                >
                  Logic Gates
                </button>
              </div>
            </div>

            <div className="sidebar-content">
              {/* Tab 1: Silicon Active Devices (MOSFETs, BJTs, Hierarchy) */}
              {activeTab === 'silicon' && (
                <>
                  <Accordion title="CMOS Transistors (BSIM)">
                    {analogPalette
                      .filter((p) => ['nmos', 'pmos'].includes(p.type))
                      .map((part) => {
                        const tipInfo = COMPONENT_TOOLTIP_DATA[part.type] ?? {
                          name: part.label,
                          category: 'MOSFET',
                          description: `${part.label} (${part.hint})`,
                          pins: '4 Pins: [D, G, S, B]',
                        };
                        return (
                          <div
                            key={part.type}
                            role="button"
                            aria-label={`Add ${part.label}`}
                            className="component-chip"
                            draggable
                            onDragStart={(e) => onPaletteDragStart(e, part.type, part.label)}
                            onClick={() => addNode(part.type, part.label)}
                          >
                            <svg className="chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              {part.type === 'nmos' && (
                                <>
                                  <line x1="6" y1="4" x2="6" y2="20" />
                                  <line x1="10" y1="6" x2="10" y2="18" />
                                  <path d="M10 8h8V4M10 16h8v4M10 12h8" />
                                  <polygon points="12 12 15 10 15 14" fill="currentColor" />
                                </>
                              )}
                              {part.type === 'pmos' && (
                                <>
                                  <line x1="4" y1="4" x2="4" y2="20" />
                                  <circle cx="7" cy="12" r="2" />
                                  <line x1="10" y1="6" x2="10" y2="18" />
                                  <path d="M10 8h8V4M10 16h8v4M10 12h8" />
                                  <polygon points="15 12 12 10 12 14" fill="currentColor" />
                                </>
                              )}
                            </svg>
                            <span className="chip-label">{part.name}</span>
                            <ComponentTooltipCard info={tipInfo} />
                          </div>
                        );
                      })}
                  </Accordion>

                  <Accordion title="Bipolar Transistors (BJT)">
                    {analogPalette
                      .filter((p) => ['bjtNpn', 'bjtPnp'].includes(p.type))
                      .map((part) => {
                        const tipInfo = COMPONENT_TOOLTIP_DATA[part.type] ?? {
                          name: part.label,
                          category: 'BJT',
                          description: `${part.label} (${part.hint})`,
                          pins: '3 Pins: [C, B, E]',
                        };
                        return (
                          <div
                            key={part.type}
                            role="button"
                            aria-label={`Add ${part.label}`}
                            className="component-chip"
                            draggable
                            onDragStart={(e) => onPaletteDragStart(e, part.type, part.label)}
                            onClick={() => addNode(part.type, part.label)}
                          >
                            <svg className="chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <line x1="4" y1="12" x2="10" y2="12" />
                              <line x1="10" y1="6" x2="10" y2="18" strokeWidth="2" />
                              <line x1="10" y1="9" x2="18" y2="4" />
                              <line x1="10" y1="15" x2="18" y2="20" />
                              <polygon points="15,17 18,20 13,20" fill="currentColor" />
                            </svg>
                            <span className="chip-label">{part.name}</span>
                            <ComponentTooltipCard info={tipInfo} />
                          </div>
                        );
                      })}
                  </Accordion>

                  <Accordion title="Hierarchical Subcircuits">
                    {analogPalette
                      .filter((p) => ['subckt'].includes(p.type))
                      .map((part) => {
                        const tipInfo = COMPONENT_TOOLTIP_DATA[part.type] ?? {
                          name: part.label,
                          category: 'HIERARCHY',
                          description: `${part.label} (${part.hint})`,
                          pins: 'Dynamic Ports',
                        };
                        return (
                          <div
                            key={part.type}
                            role="button"
                            aria-label={`Add ${part.label}`}
                            className="component-chip"
                            draggable
                            onDragStart={(e) => onPaletteDragStart(e, part.type, part.label)}
                            onClick={() => addNode(part.type, part.label)}
                          >
                            <svg className="chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <rect x="4" y="6" width="16" height="12" rx="2" />
                              <line x1="8" y1="10" x2="16" y2="10" />
                              <line x1="8" y1="14" x2="14" y2="14" />
                            </svg>
                            <span className="chip-label">{part.name}</span>
                            <ComponentTooltipCard info={tipInfo} />
                          </div>
                        );
                      })}
                  </Accordion>
                </>
              )}

              {/* Tab 2: Passives & Power References */}
              {activeTab === 'passives' && (
                <>
                  <Accordion title="Power & Clock Sources">
                    {analogPalette
                      .filter((p) => ['vsource', 'ground', 'clockSource'].includes(p.type))
                      .map((part) => {
                        const tipInfo = COMPONENT_TOOLTIP_DATA[part.type] ?? {
                          name: part.label,
                          category: 'POWER & SIGNAL',
                          description: `${part.label} (${part.hint})`,
                          pins: '2 Pins',
                        };
                        return (
                          <div
                            key={part.type}
                            role="button"
                            aria-label={`Add ${part.label}`}
                            className="component-chip"
                            draggable
                            onDragStart={(e) => onPaletteDragStart(e, part.type, part.label)}
                            onClick={() => addNode(part.type, part.label)}
                          >
                            <svg className="chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              {part.type === 'vsource' && (
                                <>
                                  <circle cx="12" cy="12" r="8" />
                                  <line x1="12" y1="8" x2="12" y2="16" />
                                  <line x1="8" y1="12" x2="16" y2="12" />
                                </>
                              )}
                              {part.type === 'ground' && (
                                <>
                                  <line x1="12" y1="4" x2="12" y2="12" />
                                  <line x1="6" y1="12" x2="18" y2="12" />
                                  <line x1="8" y1="16" x2="16" y2="16" />
                                  <line x1="10" y1="20" x2="14" y2="20" />
                                </>
                              )}
                              {part.type === 'clockSource' && (
                                <>
                                  <circle cx="12" cy="12" r="8" />
                                  <path d="M8 14V10H12V14H16V10" />
                                </>
                              )}
                            </svg>
                            <span className="chip-label">{part.name}</span>
                            <ComponentTooltipCard info={tipInfo} />
                          </div>
                        );
                      })}
                  </Accordion>

                  <Accordion title="Passive Elements">
                    {analogPalette
                      .filter((p) => ['resistor', 'capacitor', 'inductor', 'potentiometer', 'led', 'analogSwitch'].includes(p.type))
                      .map((part) => {
                        const tipInfo = COMPONENT_TOOLTIP_DATA[part.type] ?? {
                          name: part.label,
                          category: 'PASSIVE',
                          description: `${part.label} (${part.hint})`,
                          pins: '2 Pins',
                        };
                        return (
                          <div
                            key={part.type}
                            role="button"
                            aria-label={`Add ${part.label}`}
                            className="component-chip"
                            draggable
                            onDragStart={(e) => onPaletteDragStart(e, part.type, part.label)}
                            onClick={() => addNode(part.type, part.label)}
                          >
                            <svg className="chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              {part.type === 'resistor' && <polyline points="2 12 6 12 8 8 12 16 16 8 18 12 22 12" />}
                              {part.type === 'capacitor' && (
                                <>
                                  <line x1="2" y1="12" x2="10" y2="12" />
                                  <line x1="10" y1="6" x2="10" y2="18" strokeWidth="2" />
                                  <line x1="14" y1="6" x2="14" y2="18" strokeWidth="2" />
                                  <line x1="14" y1="12" x2="22" y2="12" />
                                </>
                              )}
                              {part.type === 'inductor' && <path d="M2 12 C6 6 10 6 10 12 C10 6 14 6 14 12 C14 6 18 6 18 12 L22 12" />}
                              {part.type === 'potentiometer' && (
                                <>
                                  <polyline points="2 12 6 12 8 8 12 16 16 8 18 12 22 12" />
                                  <line x1="12" y1="2" x2="12" y2="6" />
                                  <polygon points="10 6 14 6 12 10" />
                                </>
                              )}
                              {part.type === 'led' && (
                                <>
                                  <circle cx="12" cy="12" r="6" />
                                  <line x1="12" y1="2" x2="12" y2="6" />
                                  <line x1="12" y1="18" x2="12" y2="22" />
                                  <line x1="2" y1="12" x2="6" y2="12" />
                                  <line x1="18" y1="12" x2="22" y2="12" />
                                </>
                              )}
                              {part.type === 'analogSwitch' && (
                                <>
                                  <rect x="4" y="8" width="16" height="8" rx="4" />
                                  <circle cx="8" cy="12" r="2" fill="currentColor" />
                                </>
                              )}
                            </svg>
                            <span className="chip-label">{part.name}</span>
                            <ComponentTooltipCard info={tipInfo} />
                          </div>
                        );
                      })}
                  </Accordion>
                </>
              )}

              {/* Tab 3: Digital Standard Cells & I/O */}
              {activeTab === 'logic' && (
                <>
                  <Accordion title="Digital I/O Terminals">
                    <div
                      role="button"
                      aria-label="Add Input"
                      className="component-chip pinned"
                      draggable
                      onDragStart={(e) => onPaletteDragStart(e, 'input', 'Input')}
                      onClick={() => addNode('input', 'Input')}
                    >
                      <svg className="chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="4" y="8" width="16" height="8" rx="4" />
                        <circle cx="8" cy="12" r="2" fill="currentColor" />
                      </svg>
                      <span className="chip-label">Input</span>
                      <ComponentTooltipCard info={COMPONENT_TOOLTIP_DATA.input} />
                    </div>

                    <div
                      role="button"
                      aria-label="Add Output"
                      className="component-chip pinned"
                      draggable
                      onDragStart={(e) => onPaletteDragStart(e, 'output', 'Output')}
                      onClick={() => addNode('output', 'Output')}
                    >
                      <svg className="chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="12" cy="12" r="6" />
                        <line x1="12" y1="2" x2="12" y2="6" />
                        <line x1="12" y1="18" x2="12" y2="22" />
                        <line x1="2" y1="12" x2="6" y2="12" />
                        <line x1="18" y1="12" x2="22" y2="12" />
                      </svg>
                      <span className="chip-label">Output</span>
                      <ComponentTooltipCard info={COMPONENT_TOOLTIP_DATA.output} />
                    </div>
                  </Accordion>

                  <Accordion title="Standard Logic Gates">
                    {gatePalette
                      .filter((g) => ['andGate', 'orGate', 'notGate', 'nandGate', 'norGate'].includes(g.type))
                      .map((gate) => {
                        const tipInfo = COMPONENT_TOOLTIP_DATA[gate.type] ?? {
                          name: gate.label,
                          category: 'LOGIC GATE',
                          description: `${gate.label} digital logic component.`,
                          pins: '3 Pins: [In A, In B, Out Y]',
                        };
                        return (
                          <div
                            key={gate.type}
                            role="button"
                            aria-label={`Add ${gate.label}`}
                            className="component-chip"
                            draggable
                            onDragStart={(e) => onPaletteDragStart(e, gate.type, gate.label)}
                            onClick={() => addNode(gate.type, gate.label)}
                          >
                            <GateGlyph type={gate.glyph} className="chip-icon" />
                            <span className="chip-label">{gate.name}</span>
                            <ComponentTooltipCard info={tipInfo} />
                          </div>
                        );
                      })}
                  </Accordion>

                  <Accordion title="Arithmetic & Parity Gates" defaultOpen={false}>
                    {gatePalette
                      .filter((g) => ['xorGate', 'xnorGate'].includes(g.type))
                      .map((gate) => {
                        const tipInfo = COMPONENT_TOOLTIP_DATA[gate.type] ?? {
                          name: gate.label,
                          category: 'ARITHMETIC',
                          description: `${gate.label} digital logic component.`,
                          pins: '3 Pins: [In A, In B, Out Y]',
                        };
                        return (
                          <div
                            key={gate.type}
                            role="button"
                            aria-label={`Add ${gate.label}`}
                            className="component-chip"
                            draggable
                            onDragStart={(e) => onPaletteDragStart(e, gate.type, gate.label)}
                            onClick={() => addNode(gate.type, gate.label)}
                          >
                            <GateGlyph type={gate.glyph} className="chip-icon" />
                            <span className="chip-label">{gate.name}</span>
                            <ComponentTooltipCard info={tipInfo} />
                          </div>
                        );
                      })}
                  </Accordion>
                </>
              )}
            </div>
          </div>
        )}

        {sidebarView === 'vision' && (
          <section className="palette-section">
            <label htmlFor="image-upload-input" className="upload-button">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Image Upload
            </label>
            <button className="upload-button camera-button" onClick={() => setCameraOpen(true)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              Camera Capture
            </button>
            <SampleImages images={sampleImages} onImageSelect={handleSampleImageSelect} />
          </section>
        )}

        <div className="sidebar-footer">
          <button className="danger-button" onClick={clearCanvas}>
            Clear Canvas
          </button>
        </div>
      </div>
      {sidebarPinned && !isTouch && (
        <div className="panel-resizer" aria-hidden="true" onMouseDown={startSidebarResize} />
      )}
    </>
  );
}
