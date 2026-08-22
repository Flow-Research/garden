/**
 * Garden deployment program for Alchemy v2.
 *
 * Previously this was an Alchemy v1 async/await program (`await Worker(...)`,
 * `alchemy.secret.env`, TanStackStart resource). Alchemy 0.93.x is superseded by
 * the v2 line (2.0.0-beta.x), whose Effect-native resource model replaces the
 * v1 binding helpers that no longer exist. This file declares the same physical
 * Cloudflare resources with pinned names so `alchemy deploy --adopt` takes over
 * the existing infrastructure without recreating anything.
 *
 * References: https://alchemy.run/migrating-from-v1 and the installed
 * node_modules/alchemy/lib/*.d.ts type surface (docs lag the beta).
 */
import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Redacted from 'effect/Redacted'
import { deploymentTargetFromEnv } from './deploy-targets.mjs'

const deployTarget = deploymentTargetFromEnv()
const SANDBOX_IMAGE = 'docker.io/cloudflare/sandbox:0.12.4-python'

const files = Cloudflare.R2.Bucket(deployTarget.filesId, {
  name: deployTarget.filesBucket,
  // Shared preview storage is binding-compatible with canonical Postgres, but
  // only production owns destructive lifecycle.
  forceDestroy: deployTarget.emptyBucketsOnDestroy,
})

const executorBlobs = Cloudflare.R2.Bucket(deployTarget.executorBlobsId, {
  name: deployTarget.executorBlobsBucket,
  forceDestroy: deployTarget.emptyBucketsOnDestroy,
})

const database = Cloudflare.Hyperdrive.Connection(deployTarget.databaseId, {
  name: deployTarget.databaseName,
  origin: postgresOriginFromEnv(deployTarget.databaseUrlEnv),
})

const executorDatabase = Cloudflare.D1.Database(
  deployTarget.executorDatabaseId,
  {
    name: deployTarget.executorDatabaseName,
  },
)

/**
 * Owns the gateway named by the deployment target so every environment has a
 * real Workers AI routing/logging boundary. Previously preview referenced a
 * gateway that did not exist, causing every agent turn to fail after its
 * Durable Object accepted the message.
 */
const aiGateway = Cloudflare.AI.Gateway(`${deployTarget.workerId}-ai-gateway`, {
  id: deployTarget.aiGatewayId,
  collectLogs: true,
})

/**
 * Receives sampled execution events from staging without introducing runtime
 * secrets. This must deploy during push-to-deploy too; otherwise source changes
 * can leave the dashboard Worker on an older ad hoc probe script while the
 * producer keeps sending events to it.
 */
const tailConsumer = Cloudflare.Worker(deployTarget.tailWorkerId, {
  name: deployTarget.tailWorkerName,
  main: './workers/tail-observer/src/index.ts',
  compatibility: {
    date: '2026-04-18',
  },
  observability: {
    enabled: true,
    logs: {
      enabled: true,
      persist: true,
      invocationLogs: true,
    },
  },
  env: {
    ENVIRONMENT: deployTarget.environment,
    POSTHOG_PROJECT_TOKEN: plainEnv('VITE_PUBLIC_POSTHOG_PROJECT_TOKEN'),
    POSTHOG_LOGS_HOST: plainEnv('VITE_PUBLIC_POSTHOG_HOST'),
  },
})

export const web = Cloudflare.Website.Vite(deployTarget.workerId, {
  name: deployTarget.workerName,
  rootDir: './apps/web',
  compatibility: {
    date: '2026-04-18',
    flags: ['nodejs_compat'],
  },
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
  // The reconciler performs ledger cleanup without a durable deadline, so a
  // 12-hour cadence avoids unnecessary database wakeups while still repairing
  // stale product state.
  crons: ['0 */12 * * *'],
  tailConsumers: [tailConsumer],
  env: {
    AgentDO: Cloudflare.DurableObject('AgentDO'),
    Sandbox: Cloudflare.Container('Sandbox', {
      name: deployTarget.sandboxName,
      className: 'Sandbox',
      image: SANDBOX_IMAGE,
      instanceType: 'lite',
      maxInstances: 4,
    }),
    AUTOMATION_TRIGGER: Cloudflare.DurableObject('AUTOMATION_TRIGGER', {
      className: 'AutomationTriggerDO',
    }),
    EXECUTOR_DB: executorDatabase,
    EXECUTOR_BLOBS: executorBlobs,
    EXECUTOR_MCP_SESSION: Cloudflare.DurableObject('EXECUTOR_MCP_SESSION', {
      className: 'ExecutorMcpSession',
    }),
    EXECUTOR_MCP_EXECUTION_OWNER: Cloudflare.DurableObject(
      'EXECUTOR_MCP_EXECUTION_OWNER',
      { className: 'ExecutorMcpExecutionOwnerDirectory' },
    ),
    EXECUTOR_SECRET_KEY: Config.redacted('EXECUTOR_SECRET_KEY'),
    RUN_WORKFLOW: Cloudflare.Workflow(deployTarget.workflowName, {
      className: 'RunWorkflow',
    }),
    FILES: files,
    HYPERDRIVE: database,
    DATABASE_URL: Config.redacted('DATABASE_URL'),
    BETTER_AUTH_SECRET: Config.redacted('BETTER_AUTH_SECRET'),
    RESEND_API_KEY: Config.redacted('RESEND_API_KEY'),
    // Cloudflare does not expose existing Worker secret values. Omitting EXA
    // when the deploy environment lacks its plaintext value lets Workers retain
    // the currently configured secret, while CI can still rotate it by setting
    // EXA_API_KEY explicitly. Cloudflare documents that Worker secrets omitted
    // from a deployment are preserved.
    ...optionalSecretBindings(['EXA_API_KEY']),
    LOADER: Cloudflare.WorkerLoader(),
    BROWSER: Cloudflare.Workers.Browser,
    AI: Cloudflare.Workers.AI,
    EMAIL: Cloudflare.Email.SendEmail('EMAIL').pipe(Alchemy.remote()),
    // Same literal the gateway resource provisions; bound as a plain var so
    // runtime model calls route through it without a service binding.
    AI_GATEWAY_ID: deployTarget.aiGatewayId,
    SANDBOX_TRANSPORT: plainEnv('SANDBOX_TRANSPORT', 'rpc'),
    SANDBOX_LOG_LEVEL: plainEnv('SANDBOX_LOG_LEVEL', 'warn'),
    GARDEN_LOG_LEVEL: plainEnv('GARDEN_LOG_LEVEL', 'warn'),
    // Public PostHog runtime config is still bound through Alchemy so the
    // browser bundle and Worker-side event capture agree on the same project.
    // The project token is not a secret, but it is required for this product.
    VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: plainEnv(
      'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN',
    ),
    VITE_PUBLIC_POSTHOG_HOST: plainEnv('VITE_PUBLIC_POSTHOG_HOST'),
    ...(deployTarget.bindConfiguredBetterAuthUrl
      ? { BETTER_AUTH_URL: requiredProductionWebOrigin(deployTarget) }
      : {}),
    ENVIRONMENT: deployTarget.environment,
    CLOUDFLARE_ACCOUNT_ID: cloudflareAccountIdFromEnv(),
    CLOUDFLARE_MAIL_WORKER_NAME: deployTarget.workerName,
    GOOGLE_CLIENT_ID: plainEnv('GOOGLE_CLIENT_ID'),
    ...optionalPlainBindings([
      'GITHUB_CLIENT_ID',
      'GITHUB_APP_ID',
      'GITHUB_APP_SLUG',
      'SLACK_CLIENT_ID',
    ]),
    GOOGLE_CLIENT_SECRET: Config.redacted('GOOGLE_CLIENT_SECRET'),
    ...optionalSecretBindings([
      'CLOUDFLARE_MAIL_API_TOKEN',
      'GITHUB_CLIENT_SECRET',
      'GITHUB_APP_PRIVATE_KEY',
      'GITHUB_WEBHOOK_SECRET',
      'SLACK_CLIENT_SECRET',
    ]),
    ...optionalPlainBindings(['CLOUDFLARE_MAIL_API_BASE_URL']),
  },
})

export default Alchemy.Stack(
  `garden-${deployTarget.key}`,
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    // Provisioning the gateway is what creates/updates it; the web Worker
    // receives its id as a plain AI_GATEWAY_ID var below.
    yield* aiGateway
    const deployed = yield* web
    return { url: deployed.url }
  }),
)

function plainEnv(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

/** Requires the production origin at deploy time and rejects localhost.
 * Workers Builds variables are build-only, so Alchemy must explicitly carry
 * this value into the uploaded Worker version rather than silently falling back
 * to a localhost host configuration. */
function requiredProductionWebOrigin(
  target: ReturnType<typeof deploymentTargetFromEnv>,
) {
  const value = plainEnv('BETTER_AUTH_URL')
  const url = URL.parse(value)
  if (
    url === null ||
    url.protocol !== 'https:' ||
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1'
  ) {
    throw new Error(
      `BETTER_AUTH_URL must be a deployed HTTPS origin for ${target.workerName}`,
    )
  }
  return value
}

/**
 * Uses the Cloudflare-backed Alchemy state store only when non-Workers CI
 * supplies the dedicated state token. Cloudflare Workers Builds can deploy with
 * ephemeral state because every staging resource adopts existing
 * Cloudflare infrastructure.
 */
function cloudflareAccountIdFromEnv() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  if (accountId) return accountId

  throw new Error(
    'Missing CLOUDFLARE_ACCOUNT_ID. Set it in the shell, CI environment, or root .env so Alchemy and Wrangler target the same Cloudflare account.',
  )
}

type PostgresOrigin = {
  scheme: 'postgres'
  host: string
  port: number
  database: string
  user: string
  password: Redacted.Redacted<string>
}

/** Parses a Postgres connection URL into Hyperdrive's structured origin. */
function postgresOriginFromEnv(name: string): PostgresOrigin {
  const raw = plainEnv(name)
  const url = new URL(raw)
  if (
    url.protocol.replace(':', '') !== 'postgresql' &&
    url.protocol.replace(':', '') !== 'postgres'
  ) {
    throw new Error(`${name} must be a postgres:// URL for Hyperdrive`)
  }
  return {
    scheme: 'postgres' as const,
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.replace(/^\//, ''),
    user: decodeURIComponent(url.username),
    password: Redacted.make(decodeURIComponent(url.password)),
  }
}

/**
 * Optional public runtime bindings are attached only when available in the
 * deploy environment. Secret runtime bindings use `Config.redacted` so Workers
 * Builds build secrets become Cloudflare Worker secret_text bindings.
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
      .map((name) => [name, Config.redacted(name)]),
  )
}
