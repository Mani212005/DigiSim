/**
 * @file reportWebVitals.ts
 * @description Optional web-vitals reporter wired up by index.tsx; a no-op unless
 * a handler is supplied.
 */

import type { ReportHandler } from 'web-vitals';

/**
 * Lazily load web-vitals and forward each metric to the handler.
 * @param onPerfEntry - Callback invoked once per collected metric
 */
const reportWebVitals = (onPerfEntry?: ReportHandler): void => {
  if (onPerfEntry && onPerfEntry instanceof Function) {
    import('web-vitals').then(({ getCLS, getFID, getFCP, getLCP, getTTFB }) => {
      getCLS(onPerfEntry);
      getFID(onPerfEntry);
      getFCP(onPerfEntry);
      getLCP(onPerfEntry);
      getTTFB(onPerfEntry);
    });
  }
};

export default reportWebVitals;
