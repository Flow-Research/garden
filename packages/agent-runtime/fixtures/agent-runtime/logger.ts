import { mkdirSync, appendFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function createFixtureLogger(path: string) {
  mkdirSync(dirname(path), { recursive: true })
  return {
    path,
    write(event: string, data: unknown) {
      appendFileSync(
        path,
        `${JSON.stringify({ ts: new Date().toISOString(), event, data })}\n`,
      )
    },
  }
}
