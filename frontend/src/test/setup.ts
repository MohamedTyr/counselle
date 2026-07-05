import "@testing-library/jest-dom/vitest"

const localStorageStore = new Map<string, string>()
const localStorageMock: Storage = {
  get length() {
    return localStorageStore.size
  },
  clear() {
    localStorageStore.clear()
  },
  getItem(key: string) {
    return localStorageStore.get(key) ?? null
  },
  key(index: number) {
    return Array.from(localStorageStore.keys())[index] ?? null
  },
  removeItem(key: string) {
    localStorageStore.delete(key)
  },
  setItem(key: string, value: string) {
    localStorageStore.set(key, String(value))
  },
}

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: localStorageMock,
})

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorageMock,
})

Object.defineProperty(window, "innerWidth", {
  configurable: true,
  value: 1280,
  writable: true,
})

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string): MediaQueryList => ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    dispatchEvent: () => false,
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  }),
})

class ResizeObserverMock implements ResizeObserver {
  disconnect() {
    return undefined
  }

  observe() {
    return undefined
  }

  unobserve() {
    return undefined
  }
}

class IntersectionObserverMock implements IntersectionObserver {
  readonly root: Element | Document | null = null
  readonly rootMargin = ""
  readonly scrollMargin = ""
  readonly thresholds: ReadonlyArray<number> = []

  disconnect() {
    return undefined
  }

  observe() {
    return undefined
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }

  unobserve() {
    return undefined
  }
}

Object.defineProperty(window, "ResizeObserver", {
  configurable: true,
  value: ResizeObserverMock,
})

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: ResizeObserverMock,
})

Object.defineProperty(window, "IntersectionObserver", {
  configurable: true,
  value: IntersectionObserverMock,
})

Object.defineProperty(globalThis, "IntersectionObserver", {
  configurable: true,
  value: IntersectionObserverMock,
})

Element.prototype.scrollIntoView = function scrollIntoView() {
  return undefined
}

Object.defineProperty(Element.prototype, "getAnimations", {
  configurable: true,
  value: () => [],
})
