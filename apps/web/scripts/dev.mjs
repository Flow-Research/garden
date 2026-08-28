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
const offline = args.has('--offline')
const configSelection = selectWorkerConfig({
  containers: args.has('--containers'),
})
process.env.CLOUDFLARE_WORKER_CONFIG_PATH ??= configSelection.path
// Offline mode (`pnpm dev:offline`) disables remote bindings entirely: the
// vite plugin then never opens a Cloudflare session, so no account, wrangler
// login, or workers.dev subdomain is needed. The wrangler config is untouched
// — the AI binding's `"remote": true` is inert with remote bindings off, and
// the runtime routes model calls to an OpenAI-compatible endpoint instead
// (GARDEN_OFFLINE → packages/agent-runtime/src/model.ts).
process.env.CLOUDFLARE_VITE_REMOTE_BINDINGS = offline ? '0' : '1'
if (offline) {
  process.env.GARDEN_OFFLINE ??= '1'
  // Matches the compose.dev.yaml postgres service (`pnpm offline:up`). Set
  // before the Hyperdrive mapping below so the local connection string
  // inherits it. An explicit DATABASE_URL (shell or root .env) always wins —
  // except the legacy .env.example placeholder (host literally named "host"),
  // which a fresh `cp .env.example .env` used to install and which can never
  // connect; treat it as unset so offline setup works out of the box.
  if (process.env.DATABASE_URL?.includes('@host:5432/')) {
    delete process.env.DATABASE_URL
  }
  process.env.DATABASE_URL ??=
    'postgresql://garden:garden@localhost:15432/garden'
}
if (!args.has('--containers')) {
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
