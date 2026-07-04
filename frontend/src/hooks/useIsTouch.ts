/**
 * @file useIsTouch.ts
 * @description Hook that reports whether the device is primarily touch-driven.
 * Uses pointer capability (navigator.maxTouchPoints + pointer:coarse media query)
 * rather than viewport width — wide tablets are touch-only and must behave as such.
 */

import { useEffect, useState } from 'react';

/**
 * Evaluate the current touch capability, tolerating environments without
 * matchMedia (old browsers, JSDOM).
 * @returns True when the primary pointer is coarse (touch)
 */
function detectTouch(): boolean {
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
 * @returns True when the device should get touch interactions
 */
export function useIsTouch(): boolean {
  const [isTouch, setIsTouch] = useState<boolean>(detectTouch);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(pointer: coarse)');
    /**
     * Re-evaluate interaction mode when the primary pointer changes
     * (e.g. tablet keyboard docked/undocked).
     */
    const onChange = (): void => setIsTouch(detectTouch());
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return isTouch;
}
