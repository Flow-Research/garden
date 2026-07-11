import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'

const rootEnvPath = fileURLToPath(new URL('../.env', import.meta.url))
const [command, ...args] = process.argv.slice(2)

if (!command) {
  console.error('Usage: run-with-root-env <command> [...args]')
  process.exit(2)
}

if (existsSync(rootEnvPath)) loadEnvFile(rootEnvPath)

const child = spawn(command, args, {
  env: process.env,
  stdio: 'inherit',
})

child.on('error', (cause) => {
  console.error(`Failed to start ${command}:`, cause)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
