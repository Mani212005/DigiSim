/**
 * @file setupTests.ts
 * @description Jest setup — registers jest-dom matchers and polyfills ResizeObserver,
 * which ReactFlow needs but JSDOM doesn't provide.
 */

// jest-dom adds custom jest matchers for asserting on DOM nodes.
import '@testing-library/jest-dom';

// ReactFlow uses ResizeObserver which jsdom doesn't implement.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

global.ResizeObserver = ResizeObserverStub;
