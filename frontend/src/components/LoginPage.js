/**
 * @file LoginPage.js
 * @description Liquid-glass login/signup page shown to unauthenticated users.
 * Reuses the app's dark circuit-lab tokens; a floating glass card with
 * floating-label fields sits over slowly drifting neon blobs.
 */

import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import './LoginPage.css';

/**
 * Floating-label input field with glow-ring focus.
 * @param {{ id: string, type: string, label: string, value: string,
 *   onChange: (e: object) => void, autoComplete: string }} props - Field config
 * @returns {React.ReactElement} Rendered field
 */
function GlassField({ id, type, label, value, onChange, autoComplete }) {
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
 * Login/signup card with mode toggle, loading and error states.
 * @returns {React.ReactElement} Rendered login page
 */
function LoginPage() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  /**
   * Submit credentials to the active mode's endpoint.
   * @param {React.FormEvent} event - Form submit event
   */
  const onSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await (mode === 'login' ? login(email, password) : signup(email, password));
    } catch (err) {
      setError(err.message);
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
