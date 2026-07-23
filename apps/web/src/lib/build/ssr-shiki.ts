const plainTokens = (code: string) =>
  code.split('\n').map((line) =>
    line
      ? [
          {
            color: 'inherit',
            content: line,
          },
        ]
      : [],
  )

/**
 * SSR-only Shiki seam.
 *
 * Syntax highlighting runs after hydration. Keeping the complete Shiki registry
 * out of the Worker build avoids emitting every language and theme twice while
 * the browser build retains the full language set.
 */
export const bundledLanguages = new Proxy<Record<string, true>>(
  {},
  {
    has: () => true,
  },
)

export const createHighlighter = async () => ({
  codeToTokens(code: string) {
    return {
      bg: 'transparent',
      fg: 'inherit',
      tokens: plainTokens(code),
    }
  },
  getLoadedLanguages: () => [] as string[],
})

export const codeToHtml = async (code: string) =>
  `<pre><code>${code
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')}</code></pre>`
