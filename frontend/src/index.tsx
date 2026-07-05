/**
 * @file index.tsx
 * @description Application entry point — mounts the auth provider, the auth gate,
 * and the DigiSim app.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import AuthGate from './AuthGate';
import { AuthProvider } from './hooks/useAuth';
import reportWebVitals from './reportWebVitals';

// "ResizeObserver loop completed with undelivered notifications." is a benign
// browser notice (layout kept changing while observers ran — common with
// resizable panels + ReactFlow), but the CRA dev overlay presents it as a
// crash. Delivering observer callbacks on the next animation frame makes the
// synchronous loop impossible, at the cost of a one-frame layout delay.
window.ResizeObserver = class extends window.ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    super((entries, observer) => {
      window.requestAnimationFrame(() => callback(entries, observer));
    });
  }
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <AuthProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </AuthProvider>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
