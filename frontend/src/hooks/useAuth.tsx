/**
 * @file useAuth.tsx
 * @description Auth context for the DigiSim frontend. Session state lives in an
 * httpOnly cookie set by the Flask backend — this hook mirrors the logged-in user
 * (or anonymous guest) and exposes login/signup/logout/continueAsGuest actions.
 * All requests use credentials: 'include' so the cookie travels with cross-origin calls.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ApiErrorResponse, AuthResponse, AuthUser } from '../types/api';
import type { AuthContextValue } from '../types';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: false,
  isGuest: false,
  login: async () => {},
  signup: async () => {},
  logout: async () => {},
  continueAsGuest: async () => {},
});

/**
 * POST JSON to an auth endpoint and return the parsed body.
 * @param path - Endpoint path (e.g. '/auth/login')
 * @param body - Optional JSON payload
 * @returns Parsed response body typed as T
 * @throws Error with the server's message on non-2xx responses
 */
async function authRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as T & Partial<ApiErrorResponse>;
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

/**
 * Provider that restores the session on mount and exposes auth actions.
 * @param props - Subtree to provide auth to
 * @returns Provider-wrapped children
 */
export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isGuest, setIsGuest] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    /** Restore the session (real user or guest) from the httpOnly cookie, if any. */
    const restore = async (): Promise<void> => {
      try {
        const response = await fetch(`${API_URL}/auth/me`, { credentials: 'include' });
        if (response.ok) {
          const payload = (await response.json()) as AuthResponse;
          if (payload.user.guest) {
            setIsGuest(true);
          } else {
            setUser(payload.user);
          }
        }
      } catch {
        // Backend unreachable — stay logged out; LoginPage surfaces errors.
      } finally {
        setLoading(false);
      }
    };
    restore();
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const payload = await authRequest<AuthResponse>('/auth/login', { email, password });
    setUser(payload.user);
    setIsGuest(false);
  }, []);

  const signup = useCallback(async (email: string, password: string): Promise<void> => {
    const payload = await authRequest<AuthResponse>('/auth/signup', { email, password });
    setUser(payload.user);
    setIsGuest(false);
  }, []);

  const continueAsGuest = useCallback(async (): Promise<void> => {
    await authRequest<AuthResponse>('/auth/guest');
    setUser(null);
    setIsGuest(true);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    await authRequest('/auth/logout').catch(() => {});
    setUser(null);
    setIsGuest(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, isGuest, login, signup, logout, continueAsGuest }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Access the auth context.
 * @returns Auth state and actions
 */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
