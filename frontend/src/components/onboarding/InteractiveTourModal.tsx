/**
 * @file InteractiveTourModal.tsx
 * @description 60-Second Interactive Guided Onboarding Tour Modal for DigiSim.
 * Walks new and advanced users through the 5 core EDA capabilities:
 * 1) Canvas & Component Palette, 2) 4-Terminal MOSFETs & PDKs, 3) Falstad Current Flow & Waveforms,
 * 4) DigiCopilot AI Synthesizer, 5) 3D Multi-Layer PCB View.
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { InteractiveTourModalProps, TourStep } from '../../types';
import './InteractiveTourModal.css';

export const TOUR_STEPS: TourStep[] = [
  {
    step: 1,
    tag: 'Schematic Canvas',
    title: 'Canvas & Component Palette',
    description:
      'Place and interconnect digital logic gates (AND, OR, XOR, NAND, NOR), analog passives (Resistors, Potentiometers, V-Sources, LEDs, Switches), and real hardware IC chips onto an infinite, responsive ReactFlow schematic workspace.',
    highlights: [
      'Left sidebar toolbox with fast search, collapsible categories, and drag-and-drop',
      'Multi-touch gesture support with pan, pinch-to-zoom, and lasso multi-selection',
      'Signal-aware animated wires that glow cyan/green when carrying HIGH logic',
      'Full schematic persistence, JSON netlist import/export, and project folders',
    ],
    icon: '🎨',
    previewType: 'palette',
  },
  {
    step: 2,
    tag: 'Deep Submicron EDA',
    title: '4-Terminal MOSFETs & Multi-Node PDKs',
    description:
      'Design advanced analog and digital integrated circuits using industrial BSIM models across 180nm CMOS, 90nm CMOS, and 28nm HKMG process design kits (PDKs).',
    highlights: [
      'Full 4-terminal support: Drain, Gate, Source, and Bulk with auto-bulk fallback',
      'Live operating region badges: Cutoff, Triode, and Saturation with live Vth display',
      'Real-time BSIM CDF layout parasitic calculations (ad, as, pd, ps, diff area)',
      'Subcircuit hierarchy drill-down: push into OpenAccess cell views and pop back up',
    ],
    icon: '🔬',
    previewType: 'mosfet',
  },
  {
    step: 3,
    tag: 'Real-Time Simulation',
    title: 'Falstad Current Flow & Waveform Suite',
    description:
      'Watch electrical physics in action with Falstad-style dynamic green-dot particle current overlays. Particle velocity and direction accurately reflect MNA branch currents and SPICE non-linear operating points.',
    highlights: [
      'Zero-latency Modified Nodal Analysis (MNA) linear & non-linear solver engine',
      'Dynamic green-dot current particles with speed proportional to current magnitude',
      'Live in-node component readouts (mA, voltage drops, and LED brightness scaling)',
      'Bottom terminal panel (Ctrl+J) with multi-circuit truth tables & SPICE export',
    ],
    icon: '⚡',
    previewType: 'falstad',
  },
  {
    step: 4,
    tag: 'AI-Powered Copilot',
    title: 'DigiCopilot AI Circuit Synthesizer',
    description:
      'Supercharge your IC schematic design with an integrated AI assistant. Type natural language prompts to synthesize topologies, run collision-free auto-routing, optimize CMOS W/L ratios, and run PVT corner verification.',
    highlights: [
      'Natural language schematic synthesis (e.g. "CMOS Inverter", "Voltage Divider")',
      'AI trace auto-router with orthogonal Manhattan wiring and collision clearance',
      'CMOS Wp/Wn ratio optimizer for symmetrical switching and gain targets',
      'Multi-corner PVT (Process, Voltage, Temp: TT, SS, FF) automated checks',
    ],
    icon: '🤖',
    previewType: 'copilot',
  },
  {
    step: 5,
    tag: 'Physical Inspection',
    title: 'Interactive 3D Multi-Layer PCB View',
    description:
      'Inspect your schematic as a real-world multi-layer printed circuit board in WebGL 3D. Verify component footprints, copper trace routings, solder masks, and silkscreen artwork.',
    highlights: [
      'Full 3D WebGL board inspection with 360° orbit rotation, pan, and zoom',
      'Layer toggles: Top Copper, Bottom Copper, Silkscreen, FR-4 Substrate, and 3D ICs',
      'Automatic board dimensioning and trace routing generated from schematic nets',
      'Real-time physical telemetry overlay with board area and layer count',
    ],
    icon: '🧊',
    previewType: 'pcb3d',
  },
];

/**
 * Interactive Guided Onboarding Tour Modal component.
 *
 * @param props - Modal open state, close callback, and optional gallery opener
 * @returns Rendered interactive tour modal
 */
export function InteractiveTourModal({
  open,
  onClose,
  onOpenGallery,
}: InteractiveTourModalProps): React.ReactElement | null {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const step = TOUR_STEPS[currentStepIndex];
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === TOUR_STEPS.length - 1;
  const progressPercent = ((currentStepIndex + 1) / TOUR_STEPS.length) * 100;

  const handleFinish = useCallback(() => {
    if (dontShowAgain) {
      try {
        localStorage.setItem('digisim_tour_completed', 'true');
      } catch {
        /* storage unavailable */
      }
    }
    onClose();
  }, [dontShowAgain, onClose]);

  const handleNext = useCallback(() => {
    if (isLastStep) {
      handleFinish();
    } else {
      setCurrentStepIndex((prev) => prev + 1);
    }
  }, [isLastStep, handleFinish]);

  const handlePrev = useCallback(() => {
    if (!isFirstStep) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  }, [isFirstStep]);

  // Keyboard navigation: Arrow keys & Escape
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, handleNext, handlePrev, onClose]);

  if (!open) return null;

  return (
    <div
      className="tour-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-modal-title"
    >
      <div
        className="tour-modal-card glass"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Progress Bar */}
        <div className="tour-progress-bar-track">
          <div
            className="tour-progress-bar-fill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Modal Top Header */}
        <div className="tour-header">
          <div className="tour-header__left">
            <span className="tour-header__badge">
              <span className="pulse-dot" /> Step {step.step} of {TOUR_STEPS.length}
            </span>
            <span className="tour-header__tag">{step.tag}</span>
          </div>
          <button
            className="tour-close-btn"
            onClick={onClose}
            aria-label="Close Tour"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Modal Main Content (2-Column: Info & Interactive Preview) */}
        <div className="tour-body">
          {/* Left Column: Description & Feature Highlights */}
          <div className="tour-body__text">
            <div className="tour-body__title-row">
              <div className="tour-body__icon-circle">{step.icon}</div>
              <h2 id="tour-modal-title" className="tour-body__title">
                {step.title}
              </h2>
            </div>

            <p className="tour-body__desc">{step.description}</p>

            <div className="tour-body__highlights-header">
              <span>⚡ Key Capabilities:</span>
            </div>

            <ul className="tour-body__highlights">
              {step.highlights.map((item, idx) => (
                <li key={idx}>
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="3"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Right Column: Visual Interactive Feature Mockup */}
          <div className="tour-body__preview">
            {step.previewType === 'palette' && (
              <div className="tour-mockup tour-mockup--palette">
                <div className="tour-mockup__header">
                  <span className="tour-mockup__dot dot-red" />
                  <span className="tour-mockup__dot dot-yellow" />
                  <span className="tour-mockup__dot dot-green" />
                  <span className="tour-mockup__title">Palette & Schematic Canvas</span>
                </div>
                <div className="tour-mockup__canvas">
                  <div className="tour-mockup__node node-input">
                    <span className="node-tag">IN A</span>
                    <span className="node-val node-val--on">1</span>
                  </div>
                  <div className="tour-mockup__wire wire-glow" />
                  <div className="tour-mockup__node node-gate">
                    <span className="gate-icon">AND</span>
                  </div>
                  <div className="tour-mockup__wire wire-glow" />
                  <div className="tour-mockup__node node-output">
                    <span className="node-tag">OUT</span>
                    <span className="node-led-glow" />
                  </div>
                </div>
                <div className="tour-mockup__caption">
                  ✨ Drag gates from sidebar • Multi-select & Duplicate • Live Signal Glow
                </div>
              </div>
            )}

            {step.previewType === 'mosfet' && (
              <div className="tour-mockup tour-mockup--mosfet">
                <div className="tour-mockup__header">
                  <span className="tour-mockup__dot dot-red" />
                  <span className="tour-mockup__dot dot-yellow" />
                  <span className="tour-mockup__dot dot-green" />
                  <span className="tour-mockup__title">4-Terminal MOSFET PDK</span>
                </div>
                <div className="tour-mockup__mosfet-card">
                  <div className="tour-pdk-chips">
                    <span className="tour-pdk-chip active">180nm CMOS</span>
                    <span className="tour-pdk-chip">90nm</span>
                    <span className="tour-pdk-chip">28nm HKMG</span>
                  </div>
                  <div className="tour-mosfet-body">
                    <div className="tour-handle tour-handle--drain">Drain</div>
                    <div className="tour-handle tour-handle--gate">Gate</div>
                    <div className="tour-mosfet-symbol">
                      <span>NMOS_180</span>
                      <span className="tour-region-badge sat">Saturation</span>
                    </div>
                    <div className="tour-handle tour-handle--bulk">Bulk (VSS)</div>
                    <div className="tour-handle tour-handle--source">Source</div>
                  </div>
                  <div className="tour-cdf-stats">
                    <span>W=2.4µm</span>
                    <span>L=0.18µm</span>
                    <span>Vth=0.45V</span>
                    <span>Id=142µA</span>
                  </div>
                </div>
                <div className="tour-mockup__caption">
                  🔬 BSIM model cards • 4-Terminal handles • Auto-bulk fallback
                </div>
              </div>
            )}

            {step.previewType === 'falstad' && (
              <div className="tour-mockup tour-mockup--falstad">
                <div className="tour-mockup__header">
                  <span className="tour-mockup__dot dot-red" />
                  <span className="tour-mockup__dot dot-yellow" />
                  <span className="tour-mockup__dot dot-green" />
                  <span className="tour-mockup__title">Falstad Current Flow Overlay</span>
                </div>
                <div className="tour-falstad-canvas">
                  <div className="tour-falstad-wire">
                    <span className="particle p1" />
                    <span className="particle p2" />
                    <span className="particle p3" />
                    <span className="particle p4" />
                  </div>
                  <div className="tour-falstad-meter">
                    <span className="meter-label">Live Current:</span>
                    <span className="meter-val">13.6 mA</span>
                    <span className="meter-volt">ΔV = 1.80 V</span>
                  </div>
                </div>
                <div className="tour-mockup__caption">
                  ⚡ Particle speed & direction computed from MNA SPICE current vectors
                </div>
              </div>
            )}

            {step.previewType === 'copilot' && (
              <div className="tour-mockup tour-mockup--copilot">
                <div className="tour-mockup__header">
                  <span className="tour-mockup__dot dot-red" />
                  <span className="tour-mockup__dot dot-yellow" />
                  <span className="tour-mockup__dot dot-green" />
                  <span className="tour-mockup__title">DigiCopilot AI HUD</span>
                </div>
                <div className="tour-copilot-content">
                  <div className="tour-chat-msg">
                    <span className="bot-avatar">🤖</span>
                    <span className="msg-bubble">
                      "Synthesized 180nm CMOS Inverter with Wp/Wn=2.0 ratio. PVT SS/TT/FF corners verified."
                    </span>
                  </div>
                  <div className="tour-copilot-actions">
                    <span className="copilot-action-btn">✨ Auto-Route Traces</span>
                    <span className="copilot-action-btn active">📐 Optimize W/L</span>
                    <span className="copilot-action-btn">🧪 PVT Sweep</span>
                  </div>
                </div>
                <div className="tour-mockup__caption">
                  🤖 Natural language synthesis • Auto-routing • PVT corner analysis
                </div>
              </div>
            )}

            {step.previewType === 'pcb3d' && (
              <div className="tour-mockup tour-mockup--pcb3d">
                <div className="tour-mockup__header">
                  <span className="tour-mockup__dot dot-red" />
                  <span className="tour-mockup__dot dot-yellow" />
                  <span className="tour-mockup__dot dot-green" />
                  <span className="tour-mockup__title">3D Multi-Layer PCB</span>
                </div>
                <div className="tour-pcb-viewport">
                  <div className="tour-pcb-board">
                    <div className="tour-pcb-trace t1" />
                    <div className="tour-pcb-trace t2" />
                    <div className="tour-pcb-chip">IC_DIP8</div>
                  </div>
                  <div className="tour-pcb-layers">
                    <span className="layer-tag active">Top Cu</span>
                    <span className="layer-tag active">Bottom Cu</span>
                    <span className="layer-tag active">Silk</span>
                    <span className="layer-tag active">FR-4</span>
                  </div>
                </div>
                <div className="tour-mockup__caption">
                  🧊 WebGL 3D PCB rendering • 360° Orbit inspection • Layer isolation
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer Controls */}
        <div className="tour-footer">
          <div className="tour-footer__left">
            <label className="tour-checkbox-label">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
              />
              <span>Don't show this guide on startup</span>
            </label>
            {onOpenGallery && (
              <button
                className="tour-gallery-link-btn"
                onClick={() => {
                  handleFinish();
                  onOpenGallery();
                }}
              >
                🚀 Open Examples Showcase
              </button>
            )}
          </div>

          <div className="tour-footer__right">
            <div className="tour-step-indicators">
              {TOUR_STEPS.map((_, idx) => (
                <button
                  key={idx}
                  className={`tour-step-dot${
                    idx === currentStepIndex ? ' tour-step-dot--active' : ''
                  }`}
                  onClick={() => setCurrentStepIndex(idx)}
                  aria-label={`Go to step ${idx + 1}`}
                />
              ))}
            </div>

            {!isFirstStep && (
              <button className="btn tour-nav-btn" onClick={handlePrev}>
                ← Back
              </button>
            )}

            <button
              className="btn btn-primary tour-nav-btn tour-nav-btn--primary"
              onClick={handleNext}
            >
              {isLastStep ? '🎉 Start Exploring' : 'Next Step →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default InteractiveTourModal;
