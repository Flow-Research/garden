import { spawn } from 'node:child_process'
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
if (args.has('--containers')) {
  process.env.CLOUDFLARE_WORKER_CONFIG_PATH ??= 'wrangler.containers.jsonc'
}
if (args.has('--local')) {
  process.env.CLOUDFLARE_VITE_REMOTE_BINDINGS ??= '0'
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
