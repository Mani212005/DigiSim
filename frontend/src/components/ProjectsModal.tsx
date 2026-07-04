/**
 * @file ProjectsModal.tsx
 * @description Full-screen projects overlay — lists the user's folders as cards
 * (name, description, last-modified) with open/rename/delete actions and a create
 * form (name required, optional description). Folders are login-only: guests see a
 * sign-in prompt instead of the list. All circuit state stays in App; this modal
 * only manages folder metadata and hands the chosen folder back via onOpenProject.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useProjects } from '../hooks/useProjects';
import type { ProjectFolder, ProjectsModalProps } from '../types';
import './ProjectsModal.css';

/**
 * Render an ISO timestamp as a compact "how long ago" string.
 * @param iso - ISO-8601 timestamp
 * @returns Relative age like "just now", "5m ago", "3d ago", or a date
 */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}d ago`;
  return new Date(then).toLocaleDateString();
}

/**
 * Projects (folder list / create / rename / delete) modal.
 * @param props - Active folder id, open-folder callback, and close handler
 * @returns Rendered modal
 */
function ProjectsModal({
  activeProjectId,
  onOpenProject,
  onClose,
}: ProjectsModalProps): React.ReactElement {
  const { user, logout } = useAuth();
  const api = useProjects();

  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setFolders(await api.list());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (user) refresh();
    else setLoading(false);
  }, [user, refresh]);

  /** Create a folder from the form and open it immediately. */
  const create = async (): Promise<void> => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const folder = await api.create(name.trim(), description.trim());
      onOpenProject(folder);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Commit an in-place rename.
   * @param folder - Folder being renamed
   */
  const rename = async (folder: ProjectFolder): Promise<void> => {
    const next = renameValue.trim();
    setRenameId(null);
    if (!next || next === folder.name) return;
    try {
      await api.update(folder.id, { name: next });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /**
   * Delete a folder after the inline confirmation.
   * @param folder - Folder to delete
   */
  const remove = async (folder: ProjectFolder): Promise<void> => {
    setConfirmDeleteId(null);
    try {
      await api.remove(folder.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Guests share one anonymous token — folders need a real account.
  if (!user) {
    return (
      <div className="review-backdrop" role="dialog" aria-label="Projects">
        <div className="review-card projects-card projects-card--gate">
          <h2>Projects need an account</h2>
          <p className="review-sub">
            Project folders save your circuits to your account so they survive
            reloads and follow you across devices. Sign in (or create a free
            account) to use them.
          </p>
          <div className="review-actions">
            <button className="review-cancel" onClick={onClose}>
              Not now
            </button>
            <button className="review-confirm" onClick={logout}>
              Log in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="review-backdrop" role="dialog" aria-label="Projects">
      <div className="review-card projects-card">
        <div className="projects-head">
          <h2>Projects</h2>
          <div className="projects-head__actions">
            <button
              className="projects-new-btn"
              onClick={() => setCreating((c) => !c)}
            >
              {creating ? '✕ Cancel' : '+ New Folder'}
            </button>
            <button className="projects-close" aria-label="Close projects" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {creating && (
          <div className="projects-create">
            <input
              className="projects-create__name"
              placeholder="Folder name (required)"
              value={name}
              maxLength={120}
              autoFocus
              aria-label="Folder name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') create();
              }}
            />
            <textarea
              className="projects-create__desc"
              placeholder="Description (optional)"
              value={description}
              rows={2}
              aria-label="Folder description"
              onChange={(e) => setDescription(e.target.value)}
            />
            <button
              className="review-confirm"
              disabled={!name.trim() || busy}
              onClick={create}
            >
              Create
            </button>
          </div>
        )}

        {error && (
          <p className="projects-error" role="alert">
            {error}
          </p>
        )}

        <div className="projects-grid">
          {loading ? (
            <p className="projects-empty">Loading folders…</p>
          ) : folders.length === 0 && !creating ? (
            <p className="projects-empty">
              No folders yet — create one to keep a circuit saved to your account.
            </p>
          ) : (
            folders.map((folder) => (
              <div
                key={folder.id}
                className={`project-card${
                  folder.id === activeProjectId ? ' project-card--active' : ''
                }`}
              >
                {renameId === folder.id ? (
                  <input
                    className="project-card__rename"
                    value={renameValue}
                    maxLength={120}
                    autoFocus
                    aria-label={`New name for ${folder.name}`}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => rename(folder)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') rename(folder);
                      if (e.key === 'Escape') setRenameId(null);
                    }}
                  />
                ) : (
                  <button
                    className="project-card__main"
                    onClick={() => onOpenProject(folder)}
                  >
                    <span className="project-card__name">{folder.name}</span>
                    {folder.description && (
                      <span className="project-card__desc">{folder.description}</span>
                    )}
                    <span className="project-card__meta">
                      updated {timeAgo(folder.updated_at)}
                    </span>
                  </button>
                )}

                {confirmDeleteId === folder.id ? (
                  <div className="project-card__confirm">
                    <span>Delete “{folder.name}” and its circuit? This cannot be undone.</span>
                    <div className="project-card__confirm-actions">
                      <button onClick={() => setConfirmDeleteId(null)}>Keep</button>
                      <button
                        className="project-card__confirm-delete"
                        onClick={() => remove(folder)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="project-card__actions">
                    <button
                      title="Rename"
                      aria-label={`Rename ${folder.name}`}
                      onClick={() => {
                        setRenameId(folder.id);
                        setRenameValue(folder.name);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      title="Delete"
                      aria-label={`Delete ${folder.name}`}
                      onClick={() => setConfirmDeleteId(folder.id)}
                    >
                      🗑
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default ProjectsModal;
