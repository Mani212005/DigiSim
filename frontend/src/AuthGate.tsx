/**
 * @file AuthGate.tsx
 * @description Route guard: renders the app for authenticated users OR anonymous
 * guests, the liquid-glass LoginPage otherwise, and a splash while the session is
 * being restored from the httpOnly cookie.
 */

import React from 'react';
import LoginPage from './components/LoginPage';
import { useAuth } from './hooks/useAuth';

/**
 * Gate the subtree behind authentication (real account or guest session).
 * @param props - Protected app subtree
 * @returns Splash, LoginPage, or the app
 */
function AuthGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const { user, isGuest, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-splash" role="status" aria-label="Restoring session">
        <span className="spinner" />
      </div>
    );
  }
  if (!user && !isGuest) {
    return <LoginPage />;
  }
  return <>{children}</>;
}

export default AuthGate;
