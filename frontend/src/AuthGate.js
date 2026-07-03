/**
 * @file AuthGate.js
 * @description Route guard: renders the app only for authenticated users,
 * the liquid-glass LoginPage otherwise, and a splash while the session is
 * being restored from the httpOnly cookie.
 */

import React from 'react';
import LoginPage from './components/LoginPage';
import { useAuth } from './hooks/useAuth';

/**
 * Gate the subtree behind authentication.
 * @param {{ children: React.ReactNode }} props - Protected app subtree
 * @returns {React.ReactElement} Splash, LoginPage, or the app
 */
function AuthGate({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-splash" role="status" aria-label="Restoring session">
        <span className="spinner" />
      </div>
    );
  }
  if (!user) {
    return <LoginPage />;
  }
  return children;
}

export default AuthGate;
