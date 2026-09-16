/**
 * @file ComponentLibraryPanel.tsx
 * @description Sidebar panel for managing the personal library of custom components.
 */

import React, { useState, useEffect } from 'react';
import type { CustomComponentDefinition } from '../types';
import './ComponentLibraryPanel.css';

interface Props {
  onPaletteDragStart: (event: React.DragEvent, type: string, label: string, subcircuitRef: string) => void;
  addNode: (type: string, label: string, subcircuitRef: string) => void;
}

export function ComponentLibraryPanel({ onPaletteDragStart, addNode }: Props) {
  const [components, setComponents] = useState<CustomComponentDefinition[]>([]);
  const [search, setSearch] = useState('');

  const loadComponents = () => {
    try {
      const raw = localStorage.getItem('customComponents');
      if (raw) setComponents(JSON.parse(raw));
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadComponents();
    // Listen for custom event from modal
    const listener = () => loadComponents();
    window.addEventListener('digisim:library_updated', listener);
    return () => window.removeEventListener('digisim:library_updated', listener);
  }, []);

  const handleExport = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(components, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", "digisim_library.json");
    dlAnchorElem.click();
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        const existingRaw = localStorage.getItem('customComponents');
        const existing = existingRaw ? JSON.parse(existingRaw) : [];
        const merged = [...existing, ...imported]; // Simplistic merge
        // unique by id
        const unique = Array.from(new Map(merged.map(item => [item.id, item])).values());
        localStorage.setItem('customComponents', JSON.stringify(unique));
        loadComponents();
      } catch (err) {
        alert("Failed to parse JSON");
      }
    };
    reader.readAsText(file);
  };

  const filtered = components.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.category.toLowerCase().includes(search.toLowerCase()));

  // Group by category
  const grouped = filtered.reduce((acc, comp) => {
    acc[comp.category] = acc[comp.category] || [];
    acc[comp.category].push(comp);
    return acc;
  }, {} as Record<string, CustomComponentDefinition[]>);

  return (
    <div className="component-library-panel">
      <div className="library-toolbar">
        <input 
          type="text" 
          placeholder="Search components..." 
          value={search} 
          onChange={e => setSearch(e.target.value)}
          className="library-search"
        />
        <div className="library-actions">
          <button onClick={handleExport}>Export</button>
          <button onClick={() => window.dispatchEvent(new Event('digisim:open_ai_intake'))}>AI Synthesis</button>

          <label className="import-btn">
            Import
            <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
          </label>
        </div>
      </div>
      
      <div className="library-content">
        {Object.keys(grouped).map(category => (
          <div key={category} className="library-category">
            <h4 className="category-title">{category}</h4>
            <div className="category-items">
              {grouped[category].map(comp => (
                <div 
                  key={comp.id}
                  className="component-chip custom-chip"
                  draggable
                  onDragStart={(e) => onPaletteDragStart(e, 'customComponent', comp.name, comp.id)}
                  onClick={() => addNode('customComponent', comp.name, comp.id)}
                >
                  <span className="chip-icon">📦</span>
                  <span className="chip-label">{comp.name}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="library-empty">No components found.</div>
        )}
      </div>
    </div>
  );
}
