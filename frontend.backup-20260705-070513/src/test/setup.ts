import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// RTL auto-cleanup needs a global afterEach; vitest globals are off — wire it.
afterEach(cleanup);

// jsdom lacks matchMedia; app state atoms read it at module load. Stub it
// (always non-matching) so importing app modules doesn't throw.
if (typeof globalThis.matchMedia !== 'function') {
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof globalThis.matchMedia;
}

// Radix popovers (via floating-ui) need ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom (29, no URL configured) ships a Storage stub whose methods are no-ops,
// so anything backed by localStorage (e.g. the source-config store) can't be
// exercised. Install a real in-memory localStorage when the stub is inert.
if (typeof globalThis.localStorage?.clear !== 'function') {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: memoryStorage,
  });
}

// Same story for sessionStorage: jsdom's stub is inert, and the transport's
// Last-Event-ID cursor durability (FE-ATTACH-CURSOR) is backed by it. Install a
// real in-memory sessionStorage when the stub can't be exercised.
if (typeof globalThis.sessionStorage?.clear !== 'function') {
  const store = new Map<string, string>();
  const memorySession: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  };
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: memorySession,
  });
}
