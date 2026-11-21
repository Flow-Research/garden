import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const entry = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
const mobileDirectory = fileURLToPath(new URL('..', import.meta.url))
const missingNativeEvents = `
  Reflect.deleteProperty(globalThis, 'Event')
  Reflect.deleteProperty(globalThis, 'EventTarget')
`

function importSdk(beforeSdk: string) {
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `${missingNativeEvents}
       ${beforeSdk}
       const { AgentClient } = await import('agents/client')
       if (typeof AgentClient !== 'function') process.exit(2)
       process.stdout.write('sdk-imported')`,
    ],
    { cwd: mobileDirectory, encoding: 'utf8', timeout: 10_000 },
  )
}

describe('native SDK event prerequisites', () => {
  it('reproduces the SDK startup failure when native event globals are absent', () => {
    const child = importSdk('')
    expect(child.error).toBeUndefined()
    expect(child.status).not.toBe(0)
    expect(child.stderr).toContain('Event is not defined')
    expect(child.stdout).not.toContain('sdk-imported')
  })

  it('installs the supported polyfill before the app can import the SDK', () => {
    const firstImport = entry.trimStart().split('\n')[0]
    expect(firstImport).toBe("import 'partysocket/event-target-polyfill'")
    const child = importSdk("await import('partysocket/event-target-polyfill')")
    expect(child.error).toBeUndefined()
    expect(child.status, child.stderr).toBe(0)
    expect(child.stdout).toBe('sdk-imported')
  })
})
