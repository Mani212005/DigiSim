/**
 * @file useProjects.ts
 * @description Typed client for the backend /projects endpoints (login-only project
 * folders). Mirrors the authRequest pattern in useAuth: every call sends the
 * httpOnly session cookie and surfaces the server's error message on failure.
 */

import { useMemo } from 'react';
import type {
  ApiErrorResponse,
  ProjectFolder,
  ProjectListResponse,
  ProjectPatch,
  ProjectsApi,
  ProjectWithState,
} from '../types';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

/**
 * Send a JSON request to a /projects endpoint and return the parsed body.
 * @param path - Endpoint path (e.g. '/projects/3')
 * @param method - HTTP method
 * @param body - Optional JSON payload
 * @param keepalive - Keep the request alive across page unload (final flush)
 * @returns Parsed response body typed as T
 * @throws Error with the server's message on non-2xx responses
 */
async function projectRequest<T>(
  path: string,
  method: string,
  body?: unknown,
  keepalive = false
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    keepalive,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as T & Partial<ApiErrorResponse>;
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

/**
 * Access a stable, typed /projects API client.
 * @returns Memoized project CRUD functions
 */
export function useProjects(): ProjectsApi {
  return useMemo<ProjectsApi>(
    () => ({
      list: async () =>
        (await projectRequest<ProjectListResponse>('/projects', 'GET')).projects,
      create: (name: string, description: string) =>
        projectRequest<ProjectFolder>('/projects', 'POST', { name, description }),
      get: (id: number) => projectRequest<ProjectWithState>(`/projects/${id}`, 'GET'),
      update: (id: number, patch: ProjectPatch, keepalive = false) =>
        projectRequest<ProjectFolder>(`/projects/${id}`, 'PUT', patch, keepalive),
      remove: async (id: number) => {
        await projectRequest<{ ok: boolean }>(`/projects/${id}`, 'DELETE');
      },
    }),
    []
  );
}
