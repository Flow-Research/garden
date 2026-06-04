import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import alchemy from 'alchemy'
import { CloudflareStateStore } from 'alchemy/state'
import {
  Ai,
  BrowserRendering,
  Container,
  DurableObjectNamespace,
  R2Bucket,
  TanStackStart,
  WorkerLoader,
  WorkerRef,
  Workflow,
} from 'alchemy/cloudflare'

loadDotEnvFile(resolve('apps/web/.dev.vars'))
loadDotEnvFile(resolve('workers/mcp-proxy/.dev.vars'))

const cloudflareAccountId = 'a6511f2a4e765359622910fd78f8668d'
const cloudflareApiOptions = { accountId: cloudflareAccountId }

const app = await alchemy('garden', {
  stage: 'staging',
  password: process.env.ALCHEMY_PASSWORD,
  stateStore: createCiStateStore(),
})

/**
 * Cloudflare Workers Builds gives the garden-staging trigger authority to
 * upload the web worker, not create sibling workers. Reference the already
 * deployed MCP proxy so push-to-deploy can update web without replacing the
 * proxy or its dashboard-managed secrets.
 */
const mcpProxyWorkerName = 'garden-mcp-proxy'

const mcpSession = DurableObjectNamespace('mcp-session', {
  className: 'McpProxySession',
  scriptName: mcpProxyWorkerName,
  sqlite: true,
})

const mcpProxy = WorkerRef({ service: mcpProxyWorkerName })

const files = await R2Bucket('files', {
  ...cloudflareApiOptions,
  name: 'garden-files-staging',
  adopt: true,
})

const sandbox = await Container('sandbox', {
  ...cloudflareApiOptions,
  className: 'Sandbox',
  name: 'garden-web-sandbox-staging',
  tag: 'staging',
  build: {
    context: './apps/web',
    dockerfile: 'Dockerfile',
  },
  instanceType: 'lite',
  maxInstances: 4,
  adopt: true,
})

const agentDo = DurableObjectNamespace('agent-do', {
  className: 'AgentDO',
  sqlite: true,
})

const automationTrigger = DurableObjectNamespace('automation-trigger', {
  className: 'AutomationTriggerDO',
  sqlite: true,
})

export const web = await TanStackStart('web', {
  ...cloudflareApiOptions,
  name: 'garden-staging',
  cwd: './apps/web',
  adopt: true,
  compatibilityDate: '2026-04-18',
  compatibilityFlags: ['nodejs_compat'],
  observability: {
    enabled: true,
    headSamplingRate: 1,
    logs: {
      enabled: true,
      headSamplingRate: 1,
      persist: true,
      invocationLogs: true,
    },
    traces: {
      enabled: true,
      headSamplingRate: 1,
      persist: true,
    },
  },
  crons: ['* * * * *'],
  bindings: {
    AgentDO: agentDo,
    Sandbox: sandbox,
    AUTOMATION_TRIGGER: automationTrigger,
    MCP_SESSION: mcpSession,
    RUN_WORKFLOW: Workflow('run-workflow', {
      workflowName: 'garden-run-workflow-staging',
      className: 'RunWorkflow',
    }),
    FILES: files,
    LOADER: WorkerLoader(),
    BROWSER: BrowserRendering(),
    AI: Ai(),
    MCP_PROXY: mcpProxy,
    SANDBOX_TRANSPORT: plainEnv('SANDBOX_TRANSPORT', 'websocket'),
    ...optionalPlainBindings(['BETTER_AUTH_URL']),
    ENVIRONMENT: plainEnv('ENVIRONMENT', 'production'),
    ...optionalPlainBindings([
      'GITHUB_CLIENT_ID',
      'GITHUB_APP_ID',
      'GITHUB_APP_SLUG',
      'GOOGLE_CLIENT_ID',
      'SLACK_CLIENT_ID',
    ]),
  },
  dev: {
    command: 'pnpm run dev:app',
    domain: 'localhost:3000',
  },
  wrangler: {
    transform: (spec) => ({
      ...spec,
      keep_vars: true,
    }),
  },
})

console.log({ web: web.url })

await app.finalize()

function plainEnv(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

/**
 * Uses the Cloudflare-backed Alchemy state worker only when CI supplies the
 * token required to read it. Cloudflare Workers Builds can deploy with its own
 * ephemeral state when that token is absent because every staging resource is
 * configured to adopt existing Cloudflare infrastructure.
 */
function createCiStateStore() {
  const stateToken = process.env.ALCHEMY_PASSWORD
  if (!process.env.CI || !stateToken) return undefined

  return (scope: ConstructorParameters<typeof CloudflareStateStore>[0]) =>
    new CloudflareStateStore(scope, {
      ...cloudflareApiOptions,
      scriptName: 'garden-alchemy-state-staging-v2',
      stateToken: alchemy.secret(stateToken),
    })
}

/**
 * Runtime secrets are intentionally omitted from Alchemy bindings. Workers
 * deployments preserve existing script secrets, so Cloudflare push-to-deploy can
 * run without secret values while dashboard/API-managed secrets stay intact.
 */
function optionalPlainBindings(names: string[]) {
  return Object.fromEntries(
    names
      .filter((name) => process.env[name])
      .map((name) => [name, plainEnv(name)]),
  )
}

/**
 * Loads Wrangler-style .dev.vars files so Alchemy deploy uses the same local
 * runtime configuration the existing Wrangler deploy path used before this
 * migration. Shell-provided env wins, which keeps CI/profile overrides intact.
 */
function loadDotEnvFile(path: string) {
  if (!existsSync(path)) return

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separator = trimmed.indexOf('=')
    if (separator === -1) continue

    const key = trimmed.slice(0, separator).trim()
    const rawValue = trimmed.slice(separator + 1).trim()
    if (!key || process.env[key]) continue

    process.env[key] = unquoteEnvValue(rawValue)
  }
}

function unquoteEnvValue(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}
