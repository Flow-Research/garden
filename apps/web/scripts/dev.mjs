import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { superviseDevRuntime } from './dev-runtime-supervisor.mjs'

const HYPERDRIVE_BINDING = 'HYPERDRIVE'
const LOCAL_HYPERDRIVE_ENV = `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_${HYPERDRIVE_BINDING}`
const args = new Set(process.argv.slice(2))
const rootDir = fileURLToPath(new URL('../../..', import.meta.url))
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
// Root `pnpm dev` runs the package's `dev:local` target. Keep that path
// independent of Cloudflare's remote-binding control tunnel: D1/R2/DO/
// Workflows and the copied Executor credentials are local state. Container
// mode remains the explicit path that enables remote AI/blob/email bindings.
process.env.CLOUDFLARE_VITE_REMOTE_BINDINGS = containers ? '1' : '0'
if (!containers) {
  process.env.ENVIRONMENT = 'development'
}
if (process.env.DATABASE_URL) {
  process.env[LOCAL_HYPERDRIVE_ENV] ??= process.env.DATABASE_URL
}
process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV ??= 'true'

superviseDevRuntime({
  launch: () =>
    spawn('pnpm', ['exec', 'vite', 'dev'], {
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
  onSignal: (signal) => process.kill(process.pid, signal),
})

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
