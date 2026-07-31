const mermaidInstance = {
  initialize: () => undefined,
  render: async () => ({ svg: '' }),
}

/**
 * Streamdown's SSR Mermaid seam. Mermaid renders in an effect after hydration,
 * so the Worker only needs the plugin shape—not every diagram implementation.
 */
export const mermaid = {
  getMermaid: () => mermaidInstance,
  language: 'mermaid',
  name: 'mermaid',
  type: 'diagram',
} as const

export const createMermaidPlugin = () => mermaid
