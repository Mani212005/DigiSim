/**
 * @file InventoryModal.tsx
 * @description Project inventory (parts list) modal — the enrollment surface of
 * open-set recognition. Rows bind to shared-library components via fuzzy search;
 * each bound row can enroll reference images (quality feedback + community-share
 * consent). Unbound rows can create a community library entry in one click.
 * Circuit state stays in App; this modal only manages inventory + library data.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLibrary } from '../hooks/useLibrary';
import type {
  EnrollResponse,
  InventoryItem,
  InventoryModalProps,
  LibraryComponentDetail,
  LibrarySearchResult,
} from '../types';
import './InventoryModal.css';

/** Human-readable chip text for an enrollment warning token. */
const WARNING_TEXT: Record<string, string> = {
  blurry: '⚠ blurry — retake if possible',
  too_dark: '⚠ too dark',
  too_bright: '⚠ overexposed',
  embedding_unavailable: '⚠ stored without embedding (model offline)',
};

/**
 * Render one enrollment warning as user-facing text.
 * @param warning - Warning token from the backend
 * @returns Chip label
 */
function warningLabel(warning: string): string {
  if (warning.startsWith('near_duplicate_of_')) {
    return '⚠ near-duplicate of an existing reference';
  }
  return WARNING_TEXT[warning] ?? `⚠ ${warning}`;
}

/**
 * Project inventory modal.
 * @param props - Folder id/name and close handler
 * @returns Rendered modal
 */
function InventoryModal({
  folderId,
  projectName,
  onClose,
}: InventoryModalProps): React.ReactElement {
  const api = useLibrary();

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-row form.
  const [designator, setDesignator] = useState('');
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [value, setValue] = useState('');
  const [boundId, setBoundId] = useState<number | null>(null);
  const [results, setResults] = useState<LibrarySearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  // Enrollment strip.
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<LibraryComponentDetail | null>(null);
  const [consent, setConsent] = useState(true);
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [lastEnroll, setLastEnroll] = useState<EnrollResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fail = useCallback((err: unknown): void => {
    setError(err instanceof Error ? err.message : String(err));
  }, []);

  useEffect(() => {
    api
      .listInventory(folderId)
      .then(setItems)
      .catch(fail)
      .finally(() => setLoading(false));
  }, [api, folderId, fail]);

  // Debounced library search driven by the name field.
  useEffect(() => {
    if (boundId !== null || name.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    const timer = setTimeout(() => {
      api
        .search(name.trim())
        .then((hits) => {
          setResults(hits.slice(0, 6));
          setSearchOpen(true);
        })
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [name, boundId, api]);

  /** Add the drafted row to the inventory. */
  const addItem = async (): Promise<void> => {
    if (!name.trim()) return;
    try {
      const created = await api.addInventory(folderId, [
        {
          designator: designator.trim(),
          name: name.trim(),
          qty: Math.max(1, parseInt(qty, 10) || 1),
          value: value.trim(),
          library_component_id: boundId,
        },
      ]);
      setItems((rows) => rows.concat(created));
      setDesignator('');
      setName('');
      setQty('1');
      setValue('');
      setBoundId(null);
      setSearchOpen(false);
      setError(null);
    } catch (err) {
      fail(err);
    }
  };

  /**
   * Delete one inventory row.
   * @param item - Row to delete
   */
  const removeItem = async (item: InventoryItem): Promise<void> => {
    try {
      await api.deleteInventory(folderId, item.id);
      setItems((rows) => rows.filter((r) => r.id !== item.id));
      if (expandedId === item.id) setExpandedId(null);
    } catch (err) {
      fail(err);
    }
  };

  /**
   * Toggle the enrollment strip for a row, loading its library detail.
   * @param item - Row to expand/collapse
   */
  const toggleEnroll = async (item: InventoryItem): Promise<void> => {
    setLastEnroll(null);
    if (expandedId === item.id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(item.id);
    setDetail(null);
    if (item.library_component_id !== null) {
      try {
        setDetail(await api.getComponent(item.library_component_id));
      } catch (err) {
        fail(err);
      }
    }
  };

  /**
   * Create a community library entry for an unbound row and bind it.
   * @param item - Unbound inventory row
   */
  const createAndBind = async (item: InventoryItem): Promise<void> => {
    try {
      const component = await api.createComponent(item.name_raw);
      const updated = await api.updateInventory(folderId, item.id, {
        library_component_id: component.id,
      });
      setItems((rows) => rows.map((r) => (r.id === item.id ? updated : r)));
      setDetail(await api.getComponent(component.id));
      setError(null);
    } catch (err) {
      fail(err);
    }
  };

  /**
   * Enroll a chosen reference image for the expanded row's component.
   * @param event - File input change event
   */
  const onEnrollFile = async (
    event: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !detail) return;
    setEnrollBusy(true);
    setLastEnroll(null);
    try {
      const result = await api.enrollImage(detail.id, file, consent);
      setLastEnroll(result);
      setDetail(await api.getComponent(detail.id));
      setError(null);
    } catch (err) {
      fail(err);
    } finally {
      setEnrollBusy(false);
    }
  };

  const expandedItem = items.find((i) => i.id === expandedId) ?? null;

  return (
    <div className="review-backdrop" role="dialog" aria-label="Project inventory">
      <div className="review-card inventory-card">
        <div className="inventory-head">
          <h2>
            Inventory <span className="inventory-head__project">— {projectName}</span>
          </h2>
          <button className="projects-close" aria-label="Close inventory" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="review-sub">
          List this project&apos;s parts, bind them to the shared library, and add
          reference photos so detection can recognize them in your circuit images.
        </p>

        <div className="inventory-add">
          <input
            className="inv-input inv-input--des"
            placeholder="U1"
            value={designator}
            maxLength={24}
            aria-label="Designator"
            onChange={(e) => setDesignator(e.target.value)}
          />
          <div className="inv-name-wrap">
            <input
              className="inv-input inv-input--name"
              placeholder="Component name — try “esp32”…"
              value={name}
              maxLength={120}
              aria-label="Component name"
              onChange={(e) => {
                setName(e.target.value);
                setBoundId(null);
              }}
              onFocus={() => results.length > 0 && setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addItem();
                if (e.key === 'Escape') setSearchOpen(false);
              }}
            />
            {boundId !== null && <span className="inv-bound-badge">library ✓</span>}
            {searchOpen && results.length > 0 && (
              <ul className="inv-search-results" role="listbox">
                {results.map((hit) => (
                  <li key={hit.id}>
                    <button
                      onClick={() => {
                        setName(hit.canonical_name);
                        setBoundId(hit.id);
                        setSearchOpen(false);
                      }}
                    >
                      <span className="inv-hit-name">
                        {hit.canonical_name}
                        {hit.verified && <span className="inv-hit-verified"> ✓</span>}
                      </span>
                      <span className="inv-hit-meta">
                        {hit.category} · {hit.image_count ?? 0} refs
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <input
            className="inv-input inv-input--qty"
            type="number"
            min={1}
            max={999}
            value={qty}
            aria-label="Quantity"
            onChange={(e) => setQty(e.target.value)}
          />
          <input
            className="inv-input inv-input--value"
            placeholder="220Ω"
            value={value}
            maxLength={64}
            aria-label="Value"
            onChange={(e) => setValue(e.target.value)}
          />
          <button className="review-confirm inv-add-btn" disabled={!name.trim()} onClick={addItem}>
            Add
          </button>
        </div>

        {error && (
          <p className="projects-error" role="alert">
            {error}
          </p>
        )}

        <div className="inventory-list">
          {loading ? (
            <p className="projects-empty">Loading inventory…</p>
          ) : items.length === 0 ? (
            <p className="projects-empty">
              No parts yet — add each component of this build above (e.g. “U1 · ESP32
              DevKit V1 · 1”).
            </p>
          ) : (
            items.map((item) => (
              <React.Fragment key={item.id}>
                <div className={`inv-row${expandedId === item.id ? ' inv-row--open' : ''}`}>
                  <span className="inv-row__des">{item.designator || '—'}</span>
                  <span className="inv-row__name">
                    {item.name_raw}
                    {item.library_component_id !== null && (
                      <span className="inv-bound-badge">library ✓</span>
                    )}
                  </span>
                  <span className="inv-row__qty">×{item.qty}</span>
                  <span className="inv-row__value">{item.value}</span>
                  <div className="inv-row__actions">
                    <button
                      title="Reference images"
                      aria-label={`Reference images for ${item.name_raw}`}
                      onClick={() => toggleEnroll(item)}
                    >
                      📷
                    </button>
                    <button
                      title="Remove"
                      aria-label={`Remove ${item.name_raw}`}
                      onClick={() => removeItem(item)}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {expandedId === item.id && expandedItem && (
                  <div className="inv-enroll">
                    {item.library_component_id === null ? (
                      <div className="inv-enroll__create">
                        <p>
                          “{item.name_raw}” isn&apos;t in the library yet. Create a
                          community entry to attach reference photos.
                        </p>
                        <button className="review-confirm" onClick={() => createAndBind(item)}>
                          Create library entry
                        </button>
                      </div>
                    ) : detail === null ? (
                      <p className="projects-empty">Loading references…</p>
                    ) : (
                      <>
                        <div className="inv-enroll__gallery">
                          {detail.images.length === 0 && (
                            <p className="inv-enroll__hint">
                              No reference photos yet — add 2–3 views (top, angled,
                              in-circuit) so detection can identify this part.
                            </p>
                          )}
                          {detail.images.map((image) => (
                            <img
                              key={image.id}
                              className="inv-thumb"
                              src={api.imageUrl(image.id)}
                              alt={`${detail.canonical_name} reference`}
                              crossOrigin="use-credentials"
                            />
                          ))}
                        </div>
                        <div className="inv-enroll__controls">
                          <button
                            className="netlist-import-filebtn"
                            disabled={enrollBusy}
                            onClick={() => fileInputRef.current?.click()}
                          >
                            {enrollBusy ? 'Enrolling…' : '+ Add reference photo'}
                          </button>
                          <label className="inv-consent">
                            <input
                              type="checkbox"
                              checked={consent}
                              onChange={(e) => setConsent(e.target.checked)}
                            />
                            Share with the community library
                          </label>
                        </div>
                        {lastEnroll && (
                          <div className="inv-enroll__report">
                            <span className="inv-chip inv-chip--ok">
                              ✓ enrolled ({lastEnroll.image.quality.width}×
                              {lastEnroll.image.quality.height})
                            </span>
                            {lastEnroll.warnings.map((warning) => (
                              <span key={warning} className="inv-chip inv-chip--warn">
                                {warningLabel(warning)}
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </React.Fragment>
            ))
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden-file-input"
          aria-label="Reference image file"
          onChange={onEnrollFile}
        />
      </div>
    </div>
  );
}

export default InventoryModal;
