import '@testing-library/jest-dom/vitest'
import './src/bones/registry'

// JSDOM polyfills — cmdk uses ResizeObserver and scrolls its selected item
// into view; /ui's use-mobile hook reads window.matchMedia. None of the three
// ship with JSDOM so we stub them.
// `typeof … !== 'function'`, not `'scrollIntoView' in Element.prototype`: the
// `in` form narrows `Element.prototype` itself, and since lib.dom does declare
// scrollIntoView on Element, TypeScript resolves the negated branch to `never`
// and rejects the assignment. This checks the property, which leaves the
// assignment target alone. JSDOM is why the guard is needed at all — it
// declares the method in its types but does not implement it.
if (
  typeof Element !== 'undefined' &&
  typeof Element.prototype.scrollIntoView !== 'function'
) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}
