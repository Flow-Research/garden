import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { superviseDevRuntime } from './dev-runtime-supervisor.mjs'

const HYPERDRIVE_BINDING = 'HYPERDRIVE'
const LOCAL_HYPERDRIVE_ENV = `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_${HYPERDRIVE_BINDING}`
const args = new Set(process.argv.slice(2))
const rootDir = fileURLToPath(new URL('../../..', import.meta.url))
const viteEntrypoint = fileURLToPath(
  new URL('../../../node_modules/vite/bin/vite.js', import.meta.url),
)
const rootEnv = loadEnv('development', rootDir, '')

for (const [key, value] of Object.entries(rootEnv)) {
  process.env[key] ??= value
}

process.env.NODE_OPTIONS ??= '--max-old-space-size=3072'
const containers = args.has('--containers')
const configSelection = selectWorkerConfig({
  containers,
})
process.env.CLOUDFLARE_WORKER_CONFIG_PATH ??= configSelection.path
// The tracked binding config is the source of truth for local vs remote:
// D1/R2/DO/Workflows stay local, while Workers AI is explicitly remote because
// Cloudflare does not provide a local simulator. Disabling the Vite remote
// proxy globally silently overrides that per-binding contract and makes every
// manual agent turn fail before model inference.
process.env.CLOUDFLARE_VITE_REMOTE_BINDINGS = '1'
if (!containers) {
  process.env.ENVIRONMENT = 'development'
}
if (process.env.LOCAL_HYPERDRIVE_DATABASE_URL) {
  process.env[LOCAL_HYPERDRIVE_ENV] ??=
    process.env.LOCAL_HYPERDRIVE_DATABASE_URL
} else {
  throw new Error(
    'Missing LOCAL_HYPERDRIVE_DATABASE_URL. Point it at local PostgreSQL; DATABASE_URL remains the canonical remote development database.',
  )
}
process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV ??= 'true'

const supervisor = superviseDevRuntime({
  launch: () =>
    spawn(process.execPath, [viteEntrypoint, 'dev'], {
      env: process.env,
      stdio: 'inherit',
    }),
  schedule: setTimeout,
  onRestart: ({ attempt, code }) => {
    console.error(
      `[dev] runtime exited with code ${code}; restarting durable local runtime (${attempt}/5).`,
    )
  },
  onExit: (code) => process.exit(code),
  onSignal: (signal) =>
    process.exit(signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1),
})

process.once('SIGINT', () => supervisor.stop('SIGINT'))
process.once('SIGTERM', () => supervisor.stop('SIGTERM'))

/**
 * Keeps tracked Wrangler config safe for public clones while preserving local
 * overlays. The default tracked config keeps D1, R2, Durable Objects, Workflows,
 * and Hyperdrive local; only Workers AI opts into Cloudflare because it has no
 * local simulator. Container mode may use an ignored account-specific overlay.
 */
function selectWorkerConfig({ containers }) {
  const publicPath = containers ? 'wrangler.containers.jsonc' : 'wrangler.jsonc'
  const localPath = containers
    ? 'wrangler.containers.local.jsonc'
    : 'wrangler.local.jsonc'
  const localFile = fileURLToPath(new URL(`../${localPath}`, import.meta.url))
  const useLocalOverlay = containers && existsSync(localFile)

  return {
    path: useLocalOverlay ? localPath : publicPath,
  }
}
