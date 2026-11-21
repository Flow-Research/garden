/** The server-function handler must not need a product router or SSR render. */
export function getRouter(): never {
  throw new Error('Unexpected router access in server-function security test')
}
