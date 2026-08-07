import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

const HYPERDRIVE_BINDING = 'HYPERDRIVE'
const LOCAL_HYPERDRIVE_ENV = `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_${HYPERDRIVE_BINDING}`
const args = new Set(process.argv.slice(2))
const rootDir = fileURLToPath(new URL('../../..', import.meta.url))
const rootEnv = loadEnv('development', rootDir, '')

for (const [key, value] of Object.entries(rootEnv)) {
  process.env[key] ??= value
}

process.env.NODE_OPTIONS ??= '--max-old-space-size=3072'
const localOnly = args.has('--local')
const hasExplicitWorkerConfig = Boolean(
  process.env.CLOUDFLARE_WORKER_CONFIG_PATH,
)
const configSelection = selectWorkerConfig({
  containers: args.has('--containers'),
  localOnly,
})
process.env.CLOUDFLARE_WORKER_CONFIG_PATH ??= configSelection.path
if (
  localOnly ||
  (!hasExplicitWorkerConfig && configSelection.isPublicTemplate)
) {
  process.env.CLOUDFLARE_VITE_REMOTE_BINDINGS ??= '0'
}
if (localOnly) {
  process.env.ENVIRONMENT = 'development'
}
if (process.env.DATABASE_URL) {
  process.env[LOCAL_HYPERDRIVE_ENV] ??= process.env.DATABASE_URL
}
process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV ??= 'true'

const child = spawn('pnpm', ['exec', 'vite', 'dev'], {
  env: process.env,
  shell: true,
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})

/**
 * Keeps tracked Wrangler config safe for public clones while preserving the
 * existing opt-in remote-binding workflow. Before this split, live Hyperdrive
 * and D1 ids were committed; now clean clones use local placeholders and an
 * existing developer can keep remote ids in an ignored `*.local.jsonc`
 * overlay. Cloudflare Vite's documented `configPath` and `remoteBindings`
 * options make the selection explicit without changing Alchemy deployment.
 */
function selectWorkerConfig({ containers, localOnly }) {
  const publicPath = containers ? 'wrangler.containers.jsonc' : 'wrangler.jsonc'
  const localPath = containers
    ? 'wrangler.containers.local.jsonc'
    : 'wrangler.local.jsonc'
  const localFile = fileURLToPath(new URL(`../${localPath}`, import.meta.url))
  const useLocalOverlay = !localOnly && existsSync(localFile)

  return {
    path: useLocalOverlay ? localPath : publicPath,
    isPublicTemplate: !useLocalOverlay,
  }
}
