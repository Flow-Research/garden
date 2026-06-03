import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import alchemy from 'alchemy'
import { CloudflareStateStore } from 'alchemy/state'
import {
  AnalyticsEngineDataset,
  BrowserRendering,
  Container,
  DurableObjectNamespace,
  R2Bucket,
  TanStackStart,
  Worker,
  WorkerLoader,
  Workflow,
} from 'alchemy/cloudflare'

loadDotEnvFile(resolve('apps/web/.dev.vars'))
loadDotEnvFile(resolve('workers/mcp-proxy/.dev.vars'))

const runtimeCloudflareAccountId = plainEnv('CLOUDFLARE_ACCOUNT_ID')

// Alchemy resolves the deploy account from the selected profile. Garden also
// exposes CLOUDFLARE_ACCOUNT_ID to runtime code, so keep the runtime value but
// remove the env override before Alchemy creates its Cloudflare API client.
delete process.env.CLOUDFLARE_ACCOUNT_ID

const app = await alchemy('garden', {
  stage: 'staging',
  password: process.env.ALCHEMY_PASSWORD,
  stateStore: process.env.CI
    ? (scope) =>
        new CloudflareStateStore(scope, {
          scriptName: 'garden-alchemy-state-staging-v2',
          stateToken: secretEnv('ALCHEMY_PASSWORD'),
        })
    : undefined,
})

const mcpSession = DurableObjectNamespace('mcp-session', {
  className: 'McpProxySession',
  sqlite: true,
})

const mcpProxy = await Worker('mcp-proxy', {
  name: 'garden-mcp-proxy-staging',
  cwd: './workers/mcp-proxy',
  entrypoint: './src/index.ts',
  compatibilityDate: '2026-04-23',
  compatibilityFlags: ['nodejs_compat'],
  adopt: true,
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
  bindings: {
    MCP_SESSION: mcpSession,
    CONNECTOR_CALLS: AnalyticsEngineDataset('connector-calls', {
      dataset: 'garden_mcp_proxy',
    }),
    DATABASE_URL: secretEnv('DATABASE_URL'),
    BETTER_AUTH_SECRET: secretEnv('BETTER_AUTH_SECRET'),
    ...optionalPlainBindings(['BETTER_AUTH_URL']),
  },
})

const files = await R2Bucket('files', {
  name: 'garden-files-staging',
  adopt: true,
})

const sandbox = await Container('sandbox', {
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
    MCP_SESSION: mcpProxy.bindings.MCP_SESSION,
    RUN_WORKFLOW: Workflow('run-workflow', {
      workflowName: 'garden-run-workflow-staging',
      className: 'RunWorkflow',
    }),
    FILES: files,
    LOADER: WorkerLoader(),
    BROWSER: BrowserRendering(),
    MCP_PROXY: mcpProxy,
    SANDBOX_TRANSPORT: plainEnv('SANDBOX_TRANSPORT', 'websocket'),
    DATABASE_URL: secretEnv('DATABASE_URL'),
    BETTER_AUTH_SECRET: secretEnv('BETTER_AUTH_SECRET'),
    ...optionalPlainBindings(['BETTER_AUTH_URL']),
    CLOUDFLARE_ACCOUNT_ID: runtimeCloudflareAccountId,
    CF_AIG_TOKEN: secretEnv('CF_AIG_TOKEN'),
    ENVIRONMENT: plainEnv('ENVIRONMENT', 'production'),
    ...optionalSecretBindings([
      'GITHUB_CLIENT_SECRET',
      'GITHUB_APP_PRIVATE_KEY',
      'GITHUB_WEBHOOK_SECRET',
      'GOOGLE_CLIENT_SECRET',
      'SLACK_CLIENT_SECRET',
    ]),
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

function secretEnv(name: string) {
  return alchemy.secret(plainEnv(name))
}

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
      .map((name) => [name, secretEnv(name)]),
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
