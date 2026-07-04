/**
 * @file useLibrary.ts
 * @description Typed client for the component-library and project-inventory
 * endpoints (open-set recognition R1). Mirrors the useProjects pattern: every
 * call sends the httpOnly session cookie and surfaces the server's error
 * message on failure; image enrollment posts multipart form data.
 */

import { useMemo } from 'react';
import type {
  ApiErrorResponse,
  EnrollResponse,
  InventoryDraft,
  InventoryItem,
  LibraryApi,
  LibraryComponent,
  LibraryComponentDetail,
  LibrarySearchResult,
} from '../types';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

/**
 * Send a request to a library/inventory endpoint and return the parsed body.
 * @param path - Endpoint path (e.g. '/library/search?q=esp32')
 * @param init - Fetch options (method, body, headers)
 * @returns Parsed response body typed as T
 * @throws Error with the server's message on non-2xx responses
 */
async function libraryRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    ...init,
  });
  const payload = (await response.json().catch(() => ({}))) as T & Partial<ApiErrorResponse>;
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

/**
 * JSON-body variant of libraryRequest.
 * @param path - Endpoint path
 * @param method - HTTP method
 * @param body - JSON payload
 * @returns Parsed response body typed as T
 */
function jsonRequest<T>(path: string, method: string, body: unknown): Promise<T> {
  return libraryRequest<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Access a stable, typed library/inventory API client.
 * @returns Memoized library CRUD + enrollment functions
 */
export function useLibrary(): LibraryApi {
  return useMemo<LibraryApi>(
    () => ({
      search: async (query: string) =>
        (
          await libraryRequest<{ results: LibrarySearchResult[] }>(
            `/library/search?q=${encodeURIComponent(query)}`
          )
        ).results,
      getComponent: (id: number) =>
        libraryRequest<LibraryComponentDetail>(`/library/components/${id}`),
      createComponent: (canonicalName: string) =>
        jsonRequest<LibraryComponent>('/library/components', 'POST', {
          canonical_name: canonicalName,
        }),
      enrollImage: (componentId: number, file: File, consentShared: boolean) => {
        const form = new FormData();
        form.append('image', file, file.name);
        form.append('consent_shared', consentShared ? '1' : '0');
        return libraryRequest<EnrollResponse>(
          `/library/components/${componentId}/images`,
          { method: 'POST', body: form }
        );
      },
      imageUrl: (imageId: number) => `${API_URL}/library/images/${imageId}`,
      listInventory: async (folderId: number) =>
        (
          await libraryRequest<{ items: InventoryItem[] }>(
            `/projects/${folderId}/inventory`
          )
        ).items,
      addInventory: async (folderId: number, items: InventoryDraft[]) =>
        (
          await jsonRequest<{ items: InventoryItem[] }>(
            `/projects/${folderId}/inventory`,
            'POST',
            { items }
          )
        ).items,
      updateInventory: (folderId: number, itemId: number, patch: Partial<InventoryDraft>) =>
        jsonRequest<InventoryItem>(
          `/projects/${folderId}/inventory/${itemId}`,
          'PUT',
          patch
        ),
      deleteInventory: async (folderId: number, itemId: number) => {
        await libraryRequest<{ ok: boolean }>(
          `/projects/${folderId}/inventory/${itemId}`,
          { method: 'DELETE' }
        );
      },
    }),
    []
  );
}
