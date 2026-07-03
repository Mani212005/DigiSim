/**
 * @file useAuth.js
 * @description Auth context for the DigiSim frontend. Session state lives in an
 * httpOnly cookie set by the Flask backend — this hook only mirrors the logged-in
 * user object and exposes login/signup/logout actions. All requests use
 * credentials: 'include' so the cookie travels with cross-origin API calls.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

const AuthContext = createContext({
  user: null,
  loading: false,
  login: async () => {},
  signup: async () => {},
  logout: async () => {},
});

/**
 * POST JSON to an auth endpoint and return the parsed body.
 * @param {string} path - Endpoint path (e.g. '/auth/login')
 * @param {object} [body] - JSON payload
 * @returns {Promise<object>} Parsed response body
 * @throws {Error} With the server's error message on non-2xx responses
 */
async function authRequest(path, body) {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

/**
 * Provider that restores the session on mount and exposes auth actions.
 * @param {{ children: React.ReactNode }} props - Subtree to provide auth to
 * @returns {React.ReactElement} Provider-wrapped children
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    /** Restore the session from the httpOnly cookie, if any. */
    const restore = async () => {
      try {
        const response = await fetch(`${API_URL}/auth/me`, { credentials: 'include' });
        if (response.ok) {
          const payload = await response.json();
          setUser(payload.user);
        }
      } catch {
        // Backend unreachable — stay logged out; LoginPage surfaces errors.
      } finally {
        setLoading(false);
      }
    };
    restore();
  }, []);

  const login = useCallback(async (email, password) => {
    const payload = await authRequest('/auth/login', { email, password });
    setUser(payload.user);
  }, []);

  const signup = useCallback(async (email, password) => {
    const payload = await authRequest('/auth/signup', { email, password });
    setUser(payload.user);
  }, []);

  const logout = useCallback(async () => {
    await authRequest('/auth/logout').catch(() => {});
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Access the auth context.
 * @returns {{ user: object|null, loading: boolean, login: Function,
 *   signup: Function, logout: Function }} Auth state and actions
 */
export function useAuth() {
  return useContext(AuthContext);
}
