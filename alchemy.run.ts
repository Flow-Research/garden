import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import alchemy from 'alchemy'
import { CloudflareStateStore } from 'alchemy/state'
import {
  Ai,
  AiGateway,
  BrowserRendering,
  Container,
  DurableObjectNamespace,
  Hyperdrive,
  R2Bucket,
  TanStackStart,
  Worker,
  WorkerLoader,
  WorkerRef,
  Workflow,
} from 'alchemy/cloudflare'

loadDotEnvFile(resolve('apps/web/.env'))
loadDotEnvFile(resolve('workers/mcp-proxy/.env'))

/**
 * Workers Builds exposes Wrangler-compatible CF_* auth in some build contexts.
 * Alchemy and Wrangler both read CLOUDFLARE_*; mirror deprecated CF_* values
 * before resolving the account so both tools target the same account without a
 * repo-pinned fallback.
 */
if (!process.env.CLOUDFLARE_API_TOKEN && process.env.CF_API_TOKEN) {
  process.env.CLOUDFLARE_API_TOKEN = process.env.CF_API_TOKEN
}
if (!process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CF_ACCOUNT_ID) {
  process.env.CLOUDFLARE_ACCOUNT_ID = process.env.CF_ACCOUNT_ID
}

const cloudflareAccountId = cloudflareAccountIdFromEnv()
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
const tailConsumerWorkerName = 'garden-staging-tail'

const mcpSession = DurableObjectNamespace('mcp-session', {
  className: 'McpProxySession',
  scriptName: mcpProxyWorkerName,
  sqlite: true,
})

const mcpProxy = WorkerRef({ service: mcpProxyWorkerName })

/**
 * Owns the staging AI Gateway through the same push deploy path as the Worker.
 * Workers AI binding calls are already account-authenticated, but non-default
 * Gateway IDs must exist before use. Cloudflare AI Gateway docs and Alchemy's
 * resource implementation show manual gateways are created at
 * /accounts/:account/ai-gateway/gateways with the gateway ID in the body.
 */
const aiGateway = await AiGateway('ai-gateway', {
  ...cloudflareApiOptions,
  gatewayName: 'garden-staging',
  collectLogs: true,
  cacheTtl: 0,
  cacheInvalidateOnUpdate: true,
})

const files = await R2Bucket('files', {
  ...cloudflareApiOptions,
  name: 'garden-files-staging',
  adopt: true,
})

/**
 * Runtime Postgres traffic goes through Hyperdrive while migrations and other
 * Node-only tooling keep using the direct DATABASE_URL. Hyperdrive owns origin
 * pooling, so Worker code creates short-lived pg.Client instances against the
 * binding instead of app-managed Pools or module-scope database clients.
 */
const database = await Hyperdrive('database', {
  ...cloudflareApiOptions,
  name: 'garden-database-staging',
  origin: plainEnv('DATABASE_URL'),
  adopt: true,
})

/**
 * Workers Builds' generated token does not include Cloudflare Containers
 * permissions, and its build image is not a reliable Docker builder. Manual
 * Alchemy deploys still reconcile the sandbox container; push deploys omit that
 * binding rather than failing the web worker upload before the app can ship.
 */
const sandbox = process.env.WORKERS_CI
  ? undefined
  : await Container('sandbox', {
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

/**
 * Receives sampled execution events from staging without introducing runtime
 * secrets. This must deploy during push-to-deploy too; otherwise source changes
 * can leave the dashboard Worker on an older ad hoc probe script while the
 * producer keeps sending events to it.
 */
const tailConsumer = await Worker('tail', {
  ...cloudflareApiOptions,
  name: tailConsumerWorkerName,
  adopt: true,
  cwd: './workers/tail-observer',
  entrypoint: 'src/index.ts',
  compatibilityDate: '2026-04-18',
  observability: {
    enabled: true,
    logs: {
      enabled: true,
      persist: true,
      invocationLogs: true,
    },
  },
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
  tailConsumers: [tailConsumer],
  bindings: {
    AgentDO: agentDo,
    ...(sandbox ? { Sandbox: sandbox } : {}),
    AUTOMATION_TRIGGER: automationTrigger,
    MCP_SESSION: mcpSession,
    RUN_WORKFLOW: Workflow('run-workflow', {
      workflowName: 'garden-run-workflow-staging',
      className: 'RunWorkflow',
    }),
    FILES: files,
    HYPERDRIVE: database,
    DATABASE_URL: alchemy.secret.env.DATABASE_URL,
    BETTER_AUTH_SECRET: alchemy.secret.env.BETTER_AUTH_SECRET,
    RESEND_API_KEY: alchemy.secret.env.RESEND_API_KEY,
    LOADER: WorkerLoader(),
    BROWSER: BrowserRendering(),
    AI: Ai(),
    AI_GATEWAY_ID: plainEnv('AI_GATEWAY_ID', aiGateway.id),
    MCP_PROXY: mcpProxy,
    SANDBOX_TRANSPORT: plainEnv('SANDBOX_TRANSPORT', 'websocket'),
    SANDBOX_LOG_LEVEL: plainEnv('SANDBOX_LOG_LEVEL', 'warn'),
    GARDEN_LOG_LEVEL: plainEnv('GARDEN_LOG_LEVEL', 'warn'),
    ...optionalPlainBindings(['BETTER_AUTH_URL']),
    ENVIRONMENT: plainEnv('ENVIRONMENT', 'production'),
    ...optionalPlainBindings([
      'GITHUB_CLIENT_ID',
      'GITHUB_APP_ID',
      'GITHUB_APP_SLUG',
      'GOOGLE_CLIENT_ID',
      'SLACK_CLIENT_ID',
    ]),
    ...optionalSecretBindings([
      'GITHUB_CLIENT_SECRET',
      'GITHUB_APP_PRIVATE_KEY',
      'GITHUB_WEBHOOK_SECRET',
      'GOOGLE_CLIENT_SECRET',
      'SLACK_CLIENT_SECRET',
    ]),
  },
  dev: {
    command: 'pnpm exec vite dev --strictPort',
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
 * Keeps Alchemy account selection aligned with Wrangler. Cloudflare docs allow
 * either wrangler.jsonc `account_id` or CLOUDFLARE_ACCOUNT_ID; Garden uses the
 * env var so local dev, CI, Alchemy, and Wrangler share one account source.
 */
function cloudflareAccountIdFromEnv() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  if (accountId) return accountId

  throw new Error(
    'Missing CLOUDFLARE_ACCOUNT_ID. Set it in the shell, CI environment, or apps/web/.env so Alchemy and Wrangler target the same Cloudflare account.',
  )
}

/**
 * Uses the Cloudflare-backed Alchemy state worker only when non-Workers CI
 * supplies the dedicated state token. Cloudflare Workers Builds can deploy with
 * ephemeral state because every staging resource is configured to adopt existing
 * Cloudflare infrastructure.
 */
function createCiStateStore() {
  const stateToken = process.env.ALCHEMY_STATE_TOKEN
  if (process.env.WORKERS_CI || !process.env.CI || !stateToken) return undefined

  return (scope: ConstructorParameters<typeof CloudflareStateStore>[0]) =>
    new CloudflareStateStore(scope, {
      ...cloudflareApiOptions,
      scriptName: 'garden-alchemy-state-staging-v2',
      stateToken: alchemy.secret(stateToken),
    })
}

/**
 * Optional public runtime bindings are attached only when available in the
 * deploy environment. Secret runtime bindings use `alchemy.secret.env` below so
 * Workers Builds build secrets become Cloudflare Worker secret_text bindings.
 */
function optionalPlainBindings(names: string[]) {
  return Object.fromEntries(
    names
      .filter((name) => process.env[name])
      .map((name) => [name, plainEnv(name)]),
  )
}

function optionalSecretBindings(names: string[]) {
  return Object.fromEntries(
    names
      .filter((name) => process.env[name])
      .map((name) => [name, alchemy.secret.env(name)]),
  )
}

/**
 * Loads project-local .env files so Alchemy uses the same local configuration
 * as Wrangler and the Cloudflare Vite plugin. Shell-provided env wins, which
 * keeps CI/profile overrides intact.
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
