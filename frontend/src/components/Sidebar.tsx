import React, { useState } from 'react';
import './Sidebar.css';
import { GateGlyph } from '../nodes/GateShell';
import SampleImages from './SampleImages';
import type { PaletteEntry, LibraryComponent, SidebarView } from '../types';

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
  
  libraryComponents: LibraryComponent[];
  filteredLibrary: LibraryComponent[];
  librarySearch: string;
  setLibrarySearch: (search: string) => void;
  onLibraryDragStart: (event: React.DragEvent, component: LibraryComponent) => void;
  addHardwareNode: (component: LibraryComponent) => void;
  
  handleImageUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  setCameraOpen: (open: boolean) => void;
  sampleImages: string[];
  handleSampleImageSelect: (url: string) => void;
  clearCanvas: () => void;
  startSidebarResize: (event: React.MouseEvent) => void;
}

const Accordion: React.FC<{ title: string; defaultOpen?: boolean; children: React.ReactNode }> = ({ title, defaultOpen = true, children }) => {
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

export default function Sidebar({
  sidebarOpen, sidebarPinned, sidebarPeek, sidebarWidth,
  sidebarView, setSidebarView, setSidebarPinned, setSidebarPeek,
  setSidebarOpen, isTouch, holdSidebarPeek, releaseSidebarPeek,
  onPaletteDragStart, addNode, analogPalette, gatePalette,
  libraryComponents, filteredLibrary, librarySearch, setLibrarySearch,
  onLibraryDragStart, addHardwareNode,
  handleImageUpload, setCameraOpen, sampleImages, handleSampleImageSelect,
  clearCanvas, startSidebarResize
}: SidebarProps): React.ReactElement {
  
  const [activeTab, setActiveTab] = useState<'digital' | 'analog' | 'hardware'>('digital');

  return (
    <>
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
        className={`sidebar glass${sidebarOpen ? ' sidebar--open' : ''}${
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
                <span className="sidebar-menu-btn__name">Component Library</span>
                <span className="sidebar-menu-btn__sub">
                  gates, I/O, analog, and hardware parts
                </span>
              </span>
              <span className="sidebar-menu-btn__arrow" aria-hidden="true">›</span>
            </button>
            <button className="sidebar-menu-btn" onClick={() => setSidebarView('vision')}>
              <span className="sidebar-menu-btn__icon" aria-hidden="true">📷</span>
              <span className="sidebar-menu-btn__text">
                <span className="sidebar-menu-btn__name">Vision</span>
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
              {sidebarView === 'library' && 'Component Library'}
              {sidebarView === 'vision' && 'Vision'}
            </span>
          </div>
        )}

        {sidebarView === 'library' && (
          <div className="redesigned-library">
            <div className="sidebar-header">
              <div className="segment-control">
                <button 
                  className={`segment-tab ${activeTab === 'digital' ? 'active' : ''}`}
                  onClick={() => setActiveTab('digital')}
                >Digital</button>
                <button 
                  className={`segment-tab ${activeTab === 'analog' ? 'active' : ''}`}
                  onClick={() => setActiveTab('analog')}
                >Analog</button>
                <button 
                  className={`segment-tab ${activeTab === 'hardware' ? 'active' : ''}`}
                  onClick={() => setActiveTab('hardware')}
                >Hardware</button>
              </div>
              {activeTab === 'hardware' && (
                <div className="search-container">
                  <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  <input 
                    type="text" 
                    className="search-input" 
                    placeholder={`Search ${libraryComponents.length} parts...`}
                    value={librarySearch}
                    onChange={(e) => setLibrarySearch(e.target.value)}
                  />
                  <span className="search-shortcut">⌘K</span>
                </div>
              )}
            </div>

            <div className="sidebar-content">
              {activeTab === 'digital' && (
                <>
                  <Accordion title="Input / Output">
                    <div 
                      role="button"
                      aria-label="Add Input"
                      className="component-chip pinned" 
                      data-tooltip="Input Toggle Switch"
                      draggable
                      onDragStart={(e) => onPaletteDragStart(e, 'input', 'Input')}
                      onClick={() => addNode('input', 'Input')}
                    >
                      <svg className="pin-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L15 8L22 9L17 14L18 21L12 17L6 21L7 14L2 9L9 8L12 2Z"/></svg>
                      <svg className="chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="4" y="8" width="16" height="8" rx="4"/><circle cx="8" cy="12" r="2" fill="currentColor"/></svg>
                      <span className="chip-label">Input</span>
                    </div>
                    
                    <div 
                      role="button"
                      aria-label="Add Output"
                      className="component-chip pinned" 
                      data-tooltip="Output LED Indicator"
                      draggable
                      onDragStart={(e) => onPaletteDragStart(e, 'output', 'Output')}
                      onClick={() => addNode('output', 'Output')}
                    >
                      <svg className="pin-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L15 8L22 9L17 14L18 21L12 17L6 21L7 14L2 9L9 8L12 2Z"/></svg>
                      <svg className="chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="6"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>
                      <span className="chip-label">Output</span>
                    </div>
                  </Accordion>

                  <Accordion title="Basic Gates">
                    {gatePalette.filter(g => ['andGate', 'orGate', 'notGate', 'nandGate', 'norGate'].includes(g.type)).map((gate) => (
                      <div
                        key={gate.type}
                        role="button"
                        aria-label={`Add ${gate.label}`}
                        className="component-chip"
                        data-tooltip={gate.label}
                        draggable
                        onDragStart={(e) => onPaletteDragStart(e, gate.type, gate.label)}
                        onClick={() => addNode(gate.type, gate.label)}
                      >
                        <GateGlyph type={gate.glyph} className="chip-icon" />
                        <span className="chip-label">{gate.name}</span>
                      </div>
                    ))}
                  </Accordion>

                  <Accordion title="Advanced Gates" defaultOpen={false}>
                    {gatePalette.filter(g => ['xorGate', 'xnorGate'].includes(g.type)).map((gate) => (
                      <div
                        key={gate.type}
                        role="button"
                        aria-label={`Add ${gate.label}`}
                        className="component-chip"
                        data-tooltip={gate.label}
                        draggable
                        onDragStart={(e) => onPaletteDragStart(e, gate.type, gate.label)}
                        onClick={() => addNode(gate.type, gate.label)}
                      >
                        <GateGlyph type={gate.glyph} className="chip-icon" />
                        <span className="chip-label">{gate.name}</span>
                      </div>
                    ))}
                  </Accordion>
                </>
              )}

              {activeTab === 'analog' && (
                <>
                  <Accordion title="Power & Reference">
                    {analogPalette.filter(p => ['vsource', 'ground'].includes(p.type)).map((part) => (
                      <div
                        key={part.type}
                        role="button"
                        aria-label={`Add ${part.label}`}
                        className="component-chip"
                        data-tooltip={`${part.label} (${part.hint})`}
                        draggable
                        onDragStart={(e) => onPaletteDragStart(e, part.type, part.label)}
                        onClick={() => addNode(part.type, part.label)}
                      >
                        <svg className="chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          {part.type === 'vsource' && <><circle cx="12" cy="12" r="8"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></>}
                          {part.type === 'ground' && <><line x1="12" y1="4" x2="12" y2="12"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="8" y1="16" x2="16" y2="16"/><line x1="10" y1="20" x2="14" y2="20"/></>}
                        </svg>
                        <span className="chip-label">{part.name}</span>
                      </div>
                    ))}
                  </Accordion>
                  
                  <Accordion title="Passives & Output">
                    {analogPalette.filter(p => !['vsource', 'ground'].includes(p.type)).map((part) => (
                      <div
                        key={part.type}
                        role="button"
                        aria-label={`Add ${part.label}`}
                        className="component-chip"
                        data-tooltip={`${part.label} (${part.hint})`}
                        draggable
                        onDragStart={(e) => onPaletteDragStart(e, part.type, part.label)}
                        onClick={() => addNode(part.type, part.label)}
                      >
                        <svg className="chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          {part.type === 'resistor' && <polyline points="2 12 6 12 8 8 12 16 16 8 18 12 22 12"/>}
                          {part.type === 'potentiometer' && <><polyline points="2 12 6 12 8 8 12 16 16 8 18 12 22 12"/><line x1="12" y1="2" x2="12" y2="6"/><polygon points="10 6 14 6 12 10"/></>}
                          {part.type === 'led' && <><circle cx="12" cy="12" r="6"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></>}
                          {part.type === 'analogSwitch' && <><rect x="4" y="8" width="16" height="8" rx="4"/><circle cx="8" cy="12" r="2" fill="currentColor"/></>}
                        </svg>
                        <span className="chip-label">{part.name}</span>
                      </div>
                    ))}
                  </Accordion>
                </>
              )}

              {activeTab === 'hardware' && (
                <Accordion title="Library Components">
                  <div className="list-view" style={{ width: '100%', gridColumn: '1 / -1' }}>
                    {filteredLibrary.map((component) => (
                      <div
                        key={component.id}
                        className="list-chip"
                        data-tooltip={`${component.canonical_name} — click or drag`}
                        draggable
                        onDragStart={(e) => onLibraryDragStart(e, component)}
                        onClick={() => addHardwareNode(component)}
                      >
                        <svg className="chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <rect x="4" y="4" width="16" height="16" rx="2"/>
                          <line x1="2" y1="8" x2="4" y2="8"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="2" y1="16" x2="4" y2="16"/>
                          <line x1="20" y1="8" x2="22" y2="8"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="20" y1="16" x2="22" y2="16"/>
                        </svg>
                        <span className="chip-label">
                          {component.canonical_name}
                          {component.verified && <span style={{ color: 'var(--high-signal)', marginLeft: '4px' }}>✓</span>}
                        </span>
                        <span className="chip-meta">{component.pin_map.pins.length} pins</span>
                      </div>
                    ))}
                    {libraryComponents.length > 0 && filteredLibrary.length === 0 && (
                      <p className="palette-hint" style={{ gridColumn: '1 / -1', textAlign: 'center' }}>no matching parts</p>
                    )}
                  </div>
                </Accordion>
              )}
            </div>
          </div>
        )}

        {sidebarView === 'vision' && (
          <section className="palette-section">
            <label htmlFor="image-upload-input" className="upload-button">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              Image Upload
            </label>
            <button className="upload-button camera-button" onClick={() => setCameraOpen(true)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
              Camera Capture
            </button>
            <SampleImages images={sampleImages} onImageSelect={handleSampleImageSelect} />
          </section>
        )}

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
    </>
  );
}
