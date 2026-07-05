/**
 * @file PhotoReview.tsx
 * @description Review/confirm step for photo recognition (/detect_v2). Shows
 * every proposal side-by-side with the matched component's reference image,
 * lets the user correct the identity from the candidate list, drop false
 * positives, and optionally "teach the library" by enrolling the crop as a new
 * reference image — nothing lands on the canvas until confirmed.
 */

import React, { useEffect, useMemo, useState } from 'react';
import type {
  DetectCandidate,
  PhotoPlacement,
  PhotoReviewProps,
  PhotoReviewRow,
} from '../types';
import './PhotoReview.css';

/** Human-readable review reasons. */
const REASON_LABELS: Record<string, string> = {
  no_confident_match: 'no confident match',
  low_score: 'low score',
  small_margin: 'close call',
  ocr_only: 'text match only',
  no_embedding: 'no visual signal',
};

/**
 * Convert a JPEG data URI into a File for enrollment upload.
 * @param dataUri - data:image/jpeg;base64,… string
 * @param name - Filename to attach
 * @returns File wrapping the decoded bytes
 */
async function dataUriToFile(dataUri: string, name: string): Promise<File> {
  const blob = await (await fetch(dataUri)).blob();
  return new File([blob], name, { type: blob.type || 'image/jpeg' });
}

/**
 * Modal reviewing photo-detection results before placing hardware nodes.
 * @param props - Detection result, library client, confirm/cancel callbacks
 * @returns Rendered review dialog
 */
function PhotoReview({
  result,
  libraryApi,
  onConfirm,
  onCancel,
}: PhotoReviewProps): React.ReactElement {
  const [rows, setRows] = useState<PhotoReviewRow[]>(() =>
    result.proposals.map((proposal) => ({
      proposal,
      keep: proposal.assigned !== null,
      componentId: proposal.assigned?.component_id ?? null,
      teach: false,
    }))
  );
  // componentId → first reference image id (null = none / not yet fetched).
  const [refImages, setRefImages] = useState<Record<number, number | null>>({});
  const [placing, setPlacing] = useState(false);

  // Identity options: every distinct component seen across all candidate lists.
  const options = useMemo(() => {
    const byId = new Map<number, DetectCandidate>();
    result.proposals.forEach((p) =>
      p.candidates.forEach((c) => {
        if (c.component_id !== null && !byId.has(c.component_id)) {
          byId.set(c.component_id, c);
        }
      })
    );
    return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [result]);

  // Lazily fetch one reference image per selected component for the
  // side-by-side comparison.
  useEffect(() => {
    const wanted = new Set(
      rows.map((r) => r.componentId).filter((id): id is number => id !== null)
    );
    wanted.forEach((id) => {
      if (id in refImages) return;
      setRefImages((m) => ({ ...m, [id]: null }));
      libraryApi
        .getComponent(id)
        .then((detail) => {
          if (detail.images.length > 0) {
            setRefImages((m) => ({ ...m, [id]: detail.images[0].id }));
          }
        })
        .catch(() => {});
    });
  }, [rows, refImages, libraryApi]);

  /**
   * Update one review row.
   * @param index - Row index
   * @param patch - Fields to merge
   */
  const updateRow = (index: number, patch: Partial<PhotoReviewRow>): void => {
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  /** Enroll "teach" crops, then hand the kept identified rows to the canvas. */
  const confirm = async (): Promise<void> => {
    setPlacing(true);
    const kept = rows.filter((r) => r.keep && r.componentId !== null);
    // Teaching is best-effort — a failed enrollment must not block placement.
    await Promise.all(
      kept
        .filter((r) => r.teach && r.proposal.crop)
        .map(async (r) => {
          try {
            const file = await dataUriToFile(r.proposal.crop, 'detected-crop.jpg');
            await libraryApi.enrollImage(r.componentId as number, file, true);
          } catch {
            /* enrollment is optional — placement continues */
          }
        })
    );
    onConfirm(
      kept.map(
        (r): PhotoPlacement => ({
          componentId: r.componentId as number,
          box: r.proposal.box,
        })
      )
    );
  };

  const keptCount = rows.filter((r) => r.keep && r.componentId !== null).length;
  const { missing } = result.inventory_report;

  return (
    <div className="review-backdrop" role="dialog" aria-label="Review photo detection">
      <div className="review-card photo-review-card">
        <h2>Review photo detection</h2>
        <p className="review-sub">
          {result.used_inventory
            ? 'Matched against this project’s inventory.'
            : 'Matched against the shared component library.'}{' '}
          Confirm each part before it is placed on the canvas.
        </p>
        {missing.length > 0 && (
          <p className="photo-review-missing">
            Not found in photo: {missing.join(', ')}
          </p>
        )}
        <div className="review-list photo-review-list">
          {rows.map((row, index) => {
            const selected =
              row.componentId === null
                ? null
                : row.proposal.candidates.find(
                    (c) => c.component_id === row.componentId
                  ) ?? null;
            const refImageId =
              row.componentId !== null ? refImages[row.componentId] ?? null : null;
            return (
              <div
                key={row.proposal.box.x1 + '-' + row.proposal.box.y1 + '-' + index}
                className={`photo-review-row${row.keep ? '' : ' review-row--dropped'}`}
              >
                <input
                  type="checkbox"
                  checked={row.keep}
                  aria-label={`Keep detection ${index + 1}`}
                  onChange={(e) => updateRow(index, { keep: e.target.checked })}
                />
                <div className="photo-review-pair">
                  {row.proposal.crop ? (
                    <img
                      className="photo-review-crop"
                      src={row.proposal.crop}
                      alt={`Detected region ${index + 1}`}
                    />
                  ) : (
                    <div className="photo-review-crop photo-review-crop--empty">?</div>
                  )}
                  <span className="photo-review-vs">≟</span>
                  {refImageId !== null ? (
                    <img
                      className="photo-review-crop"
                      src={libraryApi.imageUrl(refImageId)}
                      crossOrigin="use-credentials"
                      alt="Matched reference"
                    />
                  ) : (
                    <div className="photo-review-crop photo-review-crop--empty">—</div>
                  )}
                </div>
                <div className="photo-review-info">
                  <select
                    value={row.componentId ?? ''}
                    aria-label={`Identity for detection ${index + 1}`}
                    disabled={!row.keep}
                    onChange={(e) =>
                      updateRow(index, {
                        componentId: e.target.value === '' ? null : Number(e.target.value),
                        teach: false,
                      })
                    }
                  >
                    <option value="">Unidentified / not a component</option>
                    {options.map((o) => (
                      <option key={o.component_id ?? o.label} value={o.component_id ?? ''}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <div className="photo-review-meta">
                    {selected && (
                      <span
                        className={`review-conf${
                          selected.score < 0.7 ? ' review-conf--low' : ''
                        }`}
                      >
                        {(selected.score * 100).toFixed(0)}%
                      </span>
                    )}
                    {row.proposal.ocr.length > 0 && (
                      <span className="photo-review-ocr" title="Text read from the crop">
                        “{row.proposal.ocr.join(' ')}”
                      </span>
                    )}
                    {row.proposal.reasons.map((reason) => (
                      <span key={reason} className="photo-review-reason">
                        {REASON_LABELS[reason] ?? reason}
                      </span>
                    ))}
                  </div>
                  <label className="photo-review-teach">
                    <input
                      type="checkbox"
                      checked={row.teach}
                      disabled={!row.keep || row.componentId === null || !row.proposal.crop}
                      onChange={(e) => updateRow(index, { teach: e.target.checked })}
                    />
                    Teach the library (save this crop as a reference image)
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        <div className="review-actions">
          <button className="review-cancel" onClick={onCancel} disabled={placing}>
            Discard
          </button>
          <button className="review-confirm" onClick={confirm} disabled={placing}>
            {placing ? 'Placing…' : `Place ${keptCount} component${keptCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PhotoReview;
