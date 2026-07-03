/**
 * @file useIsTouch.js
 * @description Hook that reports whether the device is primarily touch-driven.
 * Uses pointer capability (navigator.maxTouchPoints + pointer:coarse media query)
 * rather than viewport width — wide tablets are touch-only and must behave as such.
 */

import { useEffect, useState } from 'react';

/**
 * Evaluate the current touch capability, tolerating environments without
 * matchMedia (old browsers, JSDOM).
 * @returns {boolean} True when the primary pointer is coarse (touch)
 */
function detectTouch() {
  if (typeof navigator === 'undefined' || navigator.maxTouchPoints === 0) {
    return false;
  }
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return navigator.maxTouchPoints > 0;
  }
  return window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Detect the primary interaction mode of the device.
 * @returns {boolean} True when the device should get touch interactions
 */
export function useIsTouch() {
  const [isTouch, setIsTouch] = useState(detectTouch);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(pointer: coarse)');
    /**
     * Re-evaluate interaction mode when the primary pointer changes
     * (e.g. tablet keyboard docked/undocked).
     */
    const onChange = () => setIsTouch(detectTouch());
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return isTouch;
}
