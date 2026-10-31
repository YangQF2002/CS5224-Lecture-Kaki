import { vi } from 'vitest'

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn(),
})

Object.defineProperties(HTMLElement.prototype, {
  hasPointerCapture: {
    configurable: true,
    value: vi.fn(() => false),
  },
  setPointerCapture: {
    configurable: true,
    value: vi.fn(),
  },
  releasePointerCapture: {
    configurable: true,
    value: vi.fn(),
  },
})
