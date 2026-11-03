import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const outputDirectory = fileURLToPath(
  new URL('../../../.artifacts/evals/', import.meta.url),
)
mkdirSync(outputDirectory, { recursive: true })

const result = spawnSync(
  'promptfoo',
  [
    'eval',
    '--config',
    'promptfooconfig.yaml',
    '--output',
    `${outputDirectory}promptfoo.json`,
  ],
  {
    env: { ...process.env, PROMPTFOO_DISABLE_TELEMETRY: '1' },
    stdio: 'inherit',
  },
)

if (result.error) {
  process.stderr.write(`Could not start Promptfoo: ${result.error.message}\n`)
  process.exitCode = 2
} else {
  process.exitCode = result.status ?? 2
}
