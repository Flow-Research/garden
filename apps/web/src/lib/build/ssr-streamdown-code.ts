const themes = ['github-light', 'github-dark'] as const

/**
 * Streamdown's SSR code-highlighter seam. The browser receives the real plugin;
 * the Worker renders plaintext until hydration instead of bundling all Shiki
 * languages and themes into the server artifact.
 */
export const code = {
  getSupportedLanguages: () => [] as string[],
  getThemes: () => themes,
  highlight: () => null,
  name: 'shiki',
  supportsLanguage: () => true,
  type: 'code-highlighter',
} as const

export const createCodePlugin = () => code
