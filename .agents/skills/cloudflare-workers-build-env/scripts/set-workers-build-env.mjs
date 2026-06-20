#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  printHelp()
  process.exit(0)
}

const profile = requireArg(args, 'profile')
const accountId = requireArg(args, 'account-id')
const workerName = requireArg(args, 'worker')
const env = loadEnv(args['env-file'])
const variableNames = toArray(args['var-from'])
const secretNames = toArray(args['secret-from'])

if (variableNames.length === 0 && secretNames.length === 0) {
  throw new Error('Pass at least one --var-from NAME or --secret-from NAME')
}

const variables = Object.fromEntries(
  variableNames.map((name) => [name, readRequiredEnv(env, name)]),
)
const secrets = Object.fromEntries(
  secretNames.map((name) => [name, readRequiredEnv(env, name)]),
)

const { Provider } = await importFromAlchemy('src/auth.ts')
const { CloudflareAuth } = await importFromAlchemy('src/cloudflare/auth.ts')
const { credentials } = await Provider.getWithCredentials({
  provider: 'cloudflare',
  profile,
})
const headers = await CloudflareAuth.formatHeadersWithRefresh({
  profile,
  credentials,
})
headers['Content-Type'] = 'application/json'

const scripts = await cloudflare(
  headers,
  `/accounts/${accountId}/workers/scripts`,
)
const worker = scripts.find((script) => {
  return (
    script.id === workerName ||
    script.name === workerName ||
    script.script_name === workerName
  )
})
if (!worker) throw new Error(`Worker not found: ${workerName}`)

const externalScriptId = worker.tag ?? worker.script_tag ?? worker.id
if (!externalScriptId) {
  throw new Error(`Worker has no script tag: ${JSON.stringify(redact(worker))}`)
}

const triggers = await cloudflare(
  headers,
  `/accounts/${accountId}/builds/workers/${encodeURIComponent(
    externalScriptId,
  )}/triggers`,
)
const trigger = chooseTrigger(triggers, args)
const triggerId = trigger.trigger_uuid ?? trigger.id ?? trigger.uuid
if (!triggerId) {
  throw new Error(`Trigger has no UUID: ${JSON.stringify(redact(trigger))}`)
}

const body = {}
for (const [name, value] of Object.entries(variables)) {
  body[name] = { is_secret: false, value }
}
for (const [name, value] of Object.entries(secrets)) {
  body[name] = { is_secret: true, value }
}

await cloudflare(
  headers,
  `/accounts/${accountId}/builds/triggers/${triggerId}/environment_variables`,
  {
    method: 'PATCH',
    body: JSON.stringify(body),
  },
)

const verified = await cloudflare(
  headers,
  `/accounts/${accountId}/builds/triggers/${triggerId}/environment_variables`,
)

console.log(`worker=${workerName}`)
console.log(`trigger=${trigger.trigger_name ?? trigger.name ?? '<unnamed>'}`)
for (const name of [...variableNames, ...secretNames]) {
  const entry = verified[name]
  console.log(`${name}=${entry ? `present secret=${Boolean(entry.is_secret)}` : 'missing'}`)
}

async function importFromAlchemy(path) {
  const modulePath = resolve('node_modules/alchemy', path)
  return import(pathToFileURL(modulePath).href)
}

async function cloudflare(headers, path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  })
  const text = await response.text()
  const json = text ? JSON.parse(text) : {}
  if (!response.ok || json.success === false) {
    throw new Error(
      `${init.method ?? 'GET'} ${path} failed ${response.status}: ${JSON.stringify(
        redact(json),
      ).slice(0, 2000)}`,
    )
  }
  return json.result
}

function chooseTrigger(triggers, parsedArgs) {
  if (!Array.isArray(triggers) || triggers.length === 0) {
    throw new Error('No Workers Builds triggers found for Worker script tag')
  }

  const triggerName = parsedArgs['trigger-name']
  const branch = parsedArgs.branch
  const matches = triggers.filter((trigger) => {
    if (triggerName) {
      return (trigger.trigger_name ?? trigger.name) === triggerName
    }
    if (branch) {
      const includes = trigger.branch_includes ?? []
      return includes.includes(branch) || includes.includes('*')
    }
    return true
  })

  if (matches.length === 0) {
    throw new Error('No Workers Builds trigger matched filters')
  }
  if (matches.length > 1 && !triggerName && !branch) {
    throw new Error(
      'Multiple Workers Builds triggers found. Pass --trigger-name or --branch.',
    )
  }
  return matches[0]
}

function loadEnv(path) {
  const values = { ...process.env }
  if (!path) return values
  if (!existsSync(path)) throw new Error(`Env file not found: ${path}`)

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index === -1) continue
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
    values[key] = value
  }
  return values
}

function readRequiredEnv(env, name) {
  const value = env[name]
  if (!value) throw new Error(`Missing value for ${name}`)
  return value
}

function parseArgs(rawArgs) {
  const parsed = {}
  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index]
    if (token === '--help' || token === '-h') {
      parsed.help = true
      continue
    }
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`)
    const key = token.slice(2)
    const value = rawArgs[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${token}`)
    }
    index += 1
    if (parsed[key] === undefined) parsed[key] = value
    else if (Array.isArray(parsed[key])) parsed[key].push(value)
    else parsed[key] = [parsed[key], value]
  }
  return parsed
}

function requireArg(parsedArgs, name) {
  const value = parsedArgs[name]
  if (!value || Array.isArray(value)) throw new Error(`Missing --${name}`)
  return value
}

function toArray(value) {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const lower = key.toLowerCase()
      if (lower.includes('token') || lower.includes('secret') || lower === 'value') {
        return [key, item ? '<redacted>' : item]
      }
      return [key, redact(item)]
    }),
  )
}

function printHelp() {
  console.log(`Set Cloudflare Workers Builds trigger environment variables.

Usage:
  pnpm exec tsx .agents/skills/cloudflare-workers-build-env/scripts/set-workers-build-env.mjs \\
    --profile <alchemy-profile> \\
    --account-id <cloudflare-account-id> \\
    --worker <worker-name> \\
    --env-file <path> \\
    --var-from KEY_ONE \\
    --secret-from KEY_TWO

Options:
  --profile       Alchemy Cloudflare profile with workers_builds:read/write.
  --account-id    Cloudflare account id. Pass at runtime; do not hardcode.
  --worker        Worker name.
  --env-file      Optional local env file to read values from.
  --var-from      Env var name to set as non-secret. Repeatable.
  --secret-from   Env var name to set as secret. Repeatable.
  --trigger-name  Optional trigger display name filter.
  --branch        Optional branch filter when multiple triggers exist.
`)
}
