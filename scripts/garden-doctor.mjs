#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const REQUIRED_NODE = [22, 12]
const REQUIRED_SERVICES = ['postgres', 'helix']
const appUrl = process.env.GARDEN_URL ?? 'http://localhost:3000/'
const jsonOutput = process.argv.includes('--json')
const helpRequested =
  process.argv.includes('--help') || process.argv.includes('-h')

if (helpRequested) {
  print('Usage: pnpm run doctor [-- --json]')
  print()
  print('Checks local tools, Docker services, and the Garden app.')
  process.exit(0)
}

const checks = [
  checkNode(),
  checkPnpm(),
  checkDocker(),
  checkLocalServices(),
  await checkGardenApp(),
]

const failed = checks.filter((check) => check.status === 'failed')
const report = {
  appUrl,
  checks,
  status: failed.length === 0 ? 'passed' : 'failed',
}

if (jsonOutput) {
  print(JSON.stringify(report, null, 2))
} else {
  print('Garden doctor')
  print(`App URL: ${appUrl}`)
  print()
  for (const check of checks) {
    print(`${check.status.toUpperCase()} ${check.name}: ${check.message}`)
  }
  print()
  print(
    failed.length === 0
      ? 'Doctor passed. The local stack is ready for a verification run.'
      : `Doctor failed. Fix ${failed.length} check${failed.length === 1 ? '' : 's'} before trusting a verification run.`,
  )
}

process.exitCode = failed.length === 0 ? 0 : 1

/**
 * Writes one line to standard output without adding a lint warning for a
 * command-line program that must report its result to the user.
 */
function print(line = '') {
  process.stdout.write(`${line}\n`)
}

/**
 * Checks that the current Node.js version meets the repository requirement.
 * The check runs before local verification so agents do not diagnose toolchain
 * errors as Garden failures.
 */
function checkNode() {
  const current = parseVersion(process.versions.node)
  const passed = atLeast(current, REQUIRED_NODE)
  return result(
    'node',
    passed ? 'passed' : 'failed',
    passed
      ? `Node.js ${process.versions.node}`
      : `Node.js ${process.versions.node}; use Node.js 22.12 or newer`,
  )
}

/**
 * Checks that pnpm is available without changing the checkout or installing
 * dependencies.
 */
function checkPnpm() {
  const command = run('pnpm', ['--version'])
  if (!command.ok) {
    return result('pnpm', 'failed', command.error ?? 'pnpm is not available')
  }

  return result(
    'pnpm',
    'passed',
    `pnpm ${(command.stdout || command.stderr).trim()}`,
  )
}

/**
 * Checks that the local Docker daemon is available for Postgres and HelixDB.
 */
function checkDocker() {
  const command = run('docker', ['info'])
  return result(
    'docker',
    command.ok ? 'passed' : 'failed',
    command.ok
      ? 'Docker daemon is available'
      : (command.error ?? 'Docker daemon is not available'),
  )
}

/**
 * Checks the services that Garden's local development mode requires. Ollama is
 * optional because developers may run it outside Docker or use Workers AI.
 */
function checkLocalServices() {
  const command = run('docker', [
    'compose',
    '-f',
    'compose.dev.yaml',
    'ps',
    '--status',
    'running',
    '--services',
  ])
  if (!command.ok) {
    return result(
      'local services',
      'failed',
      command.error ?? 'Could not read compose service status',
    )
  }

  const running = new Set(command.stdout.split(/\r?\n/).filter(Boolean))
  const missing = REQUIRED_SERVICES.filter((service) => !running.has(service))
  return result(
    'local services',
    missing.length === 0 ? 'passed' : 'failed',
    missing.length === 0
      ? `running: ${REQUIRED_SERVICES.join(', ')}`
      : `not running: ${missing.join(', ')}; run pnpm offline:up`,
  )
}

/**
 * Checks that the local Garden process answers HTTP requests. Garden does not
 * have a stable health endpoint yet, so this uses the public root route.
 */
async function checkGardenApp() {
  const response = await fetch(appUrl).then(
    (value) => ({ status: value.status }),
    (error) => ({
      error: error instanceof Error ? error.message : String(error),
    }),
  )

  if ('error' in response) {
    return result(
      'Garden app',
      'failed',
      `${appUrl} did not answer: ${response.error}`,
    )
  }

  const passed = response.status >= 200 && response.status < 400
  return result(
    'Garden app',
    passed ? 'passed' : 'failed',
    passed
      ? `${appUrl} returned HTTP ${response.status}`
      : `${appUrl} returned HTTP ${response.status}`,
  )
}

/**
 * Runs a local command and keeps its output out of the report unless the
 * caller needs it to explain a failure.
 */
function run(command, args) {
  const completed = spawnSync(command, args, { encoding: 'utf8' })
  return {
    ok: completed.status === 0 && !completed.error,
    stdout: completed.stdout ?? '',
    stderr: completed.stderr ?? '',
    error:
      completed.error?.message ??
      completed.stderr?.trim() ??
      `${command} exited with status ${completed.status}`,
  }
}

/**
 * Builds one stable check result for human and JSON output.
 */
function result(name, status, message) {
  return { name, status, message }
}

/**
 * Parses a dotted semantic version into numeric components.
 */
function parseVersion(version) {
  return version.split('.').map((part) => Number.parseInt(part, 10))
}

/**
 * Compares two major and minor version pairs.
 */
function atLeast(current, required) {
  return (
    current[0] > required[0] ||
    (current[0] === required[0] && current[1] >= required[1])
  )
}
