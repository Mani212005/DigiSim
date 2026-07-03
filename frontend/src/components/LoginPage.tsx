/**
 * @file LoginPage.tsx
 * @description Liquid-glass login/signup page shown to signed-out users. Reuses the
 * app's dark circuit-lab tokens; a floating glass card with floating-label fields
 * sits over slowly drifting neon blobs. Offers a "Continue as guest" path that
 * starts a cookie-backed anonymous session.
 */

import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import type { GlassFieldProps, LoginMode } from '../types';
import './LoginPage.css';

/**
 * Floating-label input field with glow-ring focus.
 * @param props - Field id, type, label, value, change handler and autocomplete hint
 * @returns Rendered field
 */
function GlassField({
  id,
  type,
  label,
  value,
  onChange,
  autoComplete,
}: GlassFieldProps): React.ReactElement {
  return (
    <div className="glass-field">
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        placeholder=" "
        required
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

/**
 * Login/signup card with mode toggle, guest entry, and loading/error states.
 * @returns Rendered login page
 */
function LoginPage(): React.ReactElement {
  const { login, signup, continueAsGuest } = useAuth();
  const [mode, setMode] = useState<LoginMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Submit credentials to the active mode's endpoint.
   * @param event - Form submit event
   */
  const onSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await (mode === 'login' ? login(email, password) : signup(email, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** Start an anonymous guest session. */
  const onGuest = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await continueAsGuest();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-blob login-blob--cyan" aria-hidden="true" />
      <div className="login-blob login-blob--green" aria-hidden="true" />
      <div className="login-blob login-blob--violet" aria-hidden="true" />

      <div className="glass-card">
        <div className="glass-card__brand">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="12" cy="12" r="2.6" fill="currentColor" />
          </svg>
          <h1>DigiSim</h1>
          <p>{mode === 'login' ? 'Welcome back to the lab' : 'Create your lab account'}</p>
        </div>

        <form onSubmit={onSubmit}>
          <GlassField
            id="email"
            type="email"
            label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <GlassField
            id="password"
            type="password"
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />

          {error && <div className="glass-error" role="alert">{error}</div>}

          <button className="glass-submit" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : mode === 'login' ? 'Log in' : 'Sign up'}
          </button>
        </form>

        <button className="glass-guest" onClick={onGuest} disabled={busy}>
          Continue as guest
        </button>

        <button
          className="glass-switch"
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login');
            setError(null);
          }}
        >
          {mode === 'login'
            ? 'New here? Create an account'
            : 'Already have an account? Log in'}
        </button>
      </div>
    </div>
  );
}

export default LoginPage;
