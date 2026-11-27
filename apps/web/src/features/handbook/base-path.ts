/**
 * URL prefix of the handbook. It lives in its own module because the browser
 * needs it through `source.ts`, while `remark-handbook-links.ts` imports
 * `node:path` and `node:url` and must load only at build time.
 */
export const handbookBasePath = '/handbook'
