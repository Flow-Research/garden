/** Framework-generated asset manifests are outside the server-function test. */
export function tsrStartManifest(): never {
  throw new Error('Unexpected SSR manifest access in security tests')
}
