/**
 * @file CircuitGalleryModal.tsx
 * @description Interactive Circuit Gallery Showcase modal presenting curated, 1-click
 * playable sample circuits across 180nm/90nm/28nm CMOS, analog differential amplifiers,
 * ring oscillators with Falstad flow, 4-bit ripple adders, 555 timers, and RF LC filters.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SAMPLE_CIRCUITS } from './sampleCircuitsData';
import type {
  CircuitGalleryModalProps,
  SampleCircuit,
  SampleCircuitCategory,
} from '../../types';
import './CircuitGalleryModal.css';

/** Category filter tab definition. */
interface CategoryTab {
  id: SampleCircuitCategory;
  label: string;
  icon: string;
}

const CATEGORIES: CategoryTab[] = [
  { id: 'all', label: 'All Circuits', icon: '⚡' },
  { id: 'cmos', label: 'CMOS ICs', icon: '🔬' },
  { id: 'analog', label: 'Analog & Amps', icon: '📈' },
  { id: 'digital', label: 'Digital Logic', icon: '🧮' },
  { id: 'rf', label: 'RF & High-Speed', icon: '📡' },
];

/**
 * Interactive Circuit Gallery Showcase Modal dialog component.
 *
 * @param props - Modal visibility flag, close callback, and circuit loader callback
 * @returns Rendered showcase modal dialog
 */
export function CircuitGalleryModal({
  open,
  onClose,
  onLoadCircuit,
}: CircuitGalleryModalProps): React.ReactElement | null {
  const [selectedCategory, setSelectedCategory] = useState<SampleCircuitCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('all');
  const [loadedCircuitId, setLoadedCircuitId] = useState<string | null>(null);

  // Keyboard shortcut: close on Escape
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const filteredCircuits = useMemo(() => {
    return SAMPLE_CIRCUITS.filter((circuit) => {
      // Category filter
      if (selectedCategory !== 'all' && circuit.category !== selectedCategory) {
        return false;
      }
      // Difficulty filter
      if (selectedDifficulty !== 'all' && circuit.difficulty !== selectedDifficulty) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = circuit.title.toLowerCase().includes(query);
        const matchesSubtitle = circuit.subtitle.toLowerCase().includes(query);
        const matchesDesc = circuit.description.toLowerCase().includes(query);
        const matchesNode = circuit.techNode.toLowerCase().includes(query);
        const matchesFeatures = circuit.features.some((f) =>
          f.toLowerCase().includes(query)
        );
        return (
          matchesTitle ||
          matchesSubtitle ||
          matchesDesc ||
          matchesNode ||
          matchesFeatures
        );
      }
      return true;
    });
  }, [selectedCategory, selectedDifficulty, searchQuery]);

  const handleSelectCircuit = useCallback(
    (circuit: SampleCircuit) => {
      setLoadedCircuitId(circuit.id);
      onLoadCircuit(circuit);
    },
    [onLoadCircuit]
  );

  if (!open) return null;

  return (
    <div
      className="gallery-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="gallery-modal-title"
    >
      <div
        className="gallery-modal-card glass"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="gallery-header">
          <div className="gallery-header__title-group">
            <div className="gallery-header__badge">
              <span className="pulse-dot" />
              <span>Ready to Simulate</span>
            </div>
            <h2 id="gallery-modal-title" className="gallery-header__title">
              🚀 Circuit Gallery Showcase
            </h2>
            <p className="gallery-header__subtitle">
              Explore curated, 1-click playable IC designs, deep-submicron CMOS
              stages, analog amplifiers, and RF networks with real-time SPICE & MNA telemetry.
            </p>
          </div>
          <button
            className="gallery-close-btn"
            onClick={onClose}
            aria-label="Close Showcase Modal"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Search & Category Filter Bar */}
        <div className="gallery-controls">
          <div className="gallery-search-box">
            <svg
              className="gallery-search-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              className="gallery-search-input"
              placeholder="Search circuits by name, PDK (180nm/28nm), frequency, or specs…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="gallery-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <div className="gallery-filter-tabs">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                className={`gallery-filter-tab${
                  selectedCategory === cat.id ? ' gallery-filter-tab--active' : ''
                }`}
                onClick={() => setSelectedCategory(cat.id)}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
                <span className="gallery-filter-count">
                  {cat.id === 'all'
                    ? SAMPLE_CIRCUITS.length
                    : SAMPLE_CIRCUITS.filter((c) => c.category === cat.id).length}
                </span>
              </button>
            ))}
          </div>

          <div className="gallery-difficulty-pills">
            <span className="gallery-difficulty-label">Difficulty:</span>
            {['all', 'Beginner', 'Intermediate', 'Advanced'].map((diff) => (
              <button
                key={diff}
                className={`gallery-diff-pill${
                  selectedDifficulty === diff ? ' gallery-diff-pill--active' : ''
                }`}
                onClick={() => setSelectedDifficulty(diff)}
              >
                {diff === 'all' ? 'All Levels' : diff}
              </button>
            ))}
          </div>
        </div>

        {/* Circuit Cards Grid */}
        <div className="gallery-grid">
          {filteredCircuits.length === 0 ? (
            <div className="gallery-empty">
              <div className="gallery-empty__icon">🔍</div>
              <h3>No matching circuits found</h3>
              <p>Try refining your search query or switching the category filter.</p>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('all');
                  setSelectedDifficulty('all');
                }}
              >
                Reset Filters
              </button>
            </div>
          ) : (
            filteredCircuits.map((circuit) => {
              const isLoaded = loadedCircuitId === circuit.id;
              return (
                <div
                  key={circuit.id}
                  className={`circuit-card${isLoaded ? ' circuit-card--loaded' : ''}`}
                >
                  <div className="circuit-card__header">
                    <div className="circuit-card__icon-wrapper">
                      <span className="circuit-card__icon">{circuit.icon}</span>
                    </div>
                    <div className="circuit-card__badges">
                      <span className="circuit-card__tech-badge">
                        {circuit.techNode}
                      </span>
                      <span
                        className={`circuit-card__diff-badge circuit-card__diff-badge--${circuit.difficulty.toLowerCase()}`}
                      >
                        {circuit.difficulty}
                      </span>
                    </div>
                  </div>

                  <div className="circuit-card__content">
                    <h3 className="circuit-card__title">{circuit.title}</h3>
                    <div className="circuit-card__subtitle">{circuit.subtitle}</div>
                    <p className="circuit-card__desc">{circuit.description}</p>

                    {/* Stats Metrics Bar */}
                    <div className="circuit-card__stats">
                      <div className="circuit-stat">
                        <span className="circuit-stat__label">Components</span>
                        <span className="circuit-stat__val">
                          {circuit.stats.nodes} nodes
                        </span>
                      </div>
                      <div className="circuit-stat">
                        <span className="circuit-stat__label">Nets</span>
                        <span className="circuit-stat__val">
                          {circuit.stats.edges} wires
                        </span>
                      </div>
                      {circuit.stats.speed && (
                        <div className="circuit-stat">
                          <span className="circuit-stat__label">Frequency</span>
                          <span className="circuit-stat__val circuit-stat__val--accent">
                            {circuit.stats.speed}
                          </span>
                        </div>
                      )}
                      {circuit.stats.gain && (
                        <div className="circuit-stat">
                          <span className="circuit-stat__label">Gain</span>
                          <span className="circuit-stat__val circuit-stat__val--gain">
                            {circuit.stats.gain}
                          </span>
                        </div>
                      )}
                      {circuit.stats.power && (
                        <div className="circuit-stat">
                          <span className="circuit-stat__label">Power</span>
                          <span className="circuit-stat__val">
                            {circuit.stats.power}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Key Features Bullet List */}
                    <ul className="circuit-card__features">
                      {circuit.features.map((feat, idx) => (
                        <li key={idx}>
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#4ade80"
                            strokeWidth="3"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="circuit-card__footer">
                    <button
                      className={`circuit-card__load-btn btn${
                        isLoaded ? ' circuit-card__load-btn--active' : ''
                      }`}
                      onClick={() => handleSelectCircuit(circuit)}
                    >
                      {isLoaded ? (
                        <>
                          <span className="pulse-dot" /> Circuit Loaded
                        </>
                      ) : (
                        <>
                          <span>▶</span> Load into Canvas
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer Tip */}
        <div className="gallery-footer">
          <div className="gallery-footer__tip">
            <span className="gallery-footer__tip-icon">💡</span>
            <span>
              <strong>Pro-tip:</strong> After loading any example, hit <strong>⌘ Terminal</strong> for real-time truth tables & SPICE export, or toggle <strong>Falstad Flow</strong> for live current particle visualization!
            </span>
          </div>
          <button className="btn gallery-footer__close" onClick={onClose}>
            Close Gallery
          </button>
        </div>
      </div>
    </div>
  );
}

export default CircuitGalleryModal;
