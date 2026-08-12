import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'
import alchemy from 'alchemy'
import { CloudflareStateStore } from 'alchemy/state'
import {
  Ai,
  BrowserRendering,
  Container,
  D1Database,
  DurableObjectNamespace,
  EmailSender,
  Hyperdrive,
  R2Bucket,
  TanStackStart,
  Worker,
  WorkerLoader,
  Workflow,
} from 'alchemy/cloudflare'
import { deploymentTargetFromEnv } from './deploy-targets.mjs'

const rootEnvPath = fileURLToPath(new URL('./.env', import.meta.url))
if (existsSync(rootEnvPath)) loadEnvFile(rootEnvPath)

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

const deployTarget = deploymentTargetFromEnv()
const cloudflareAccountId = cloudflareAccountIdFromEnv()
const cloudflareApiOptions = { accountId: cloudflareAccountId }
const SANDBOX_IMAGE = 'docker.io/cloudflare/sandbox:0.12.4-python'

const app = await alchemy(deployTarget.appName, {
  stage: deployTarget.stage,
  password: process.env.ALCHEMY_PASSWORD,
  stateStore: createCiStateStore(),
})

const files = await R2Bucket(deployTarget.filesId, {
  ...cloudflareApiOptions,
  name: deployTarget.filesBucket,
  adopt: true,
  empty: deployTarget.emptyBucketsOnDestroy,
})

/**
 * Runtime Postgres traffic goes through Hyperdrive while migrations and other
 * Node-only tooling keep using the direct DATABASE_URL. Hyperdrive owns origin
 * pooling, so Worker code creates short-lived pg.Client instances against the
 * binding instead of app-managed Pools or module-scope database clients.
 */
const database = await Hyperdrive(deployTarget.databaseId, {
  ...cloudflareApiOptions,
  name: deployTarget.databaseName,
  // Preview intentionally shares the current Postgres origin by explicit user
  // decision. Its Hyperdrive configuration remains independently destructible.
  origin: plainEnv(deployTarget.databaseUrlEnv),
  adopt: true,
})

const executorDatabase = await D1Database(deployTarget.executorDatabaseId, {
  ...cloudflareApiOptions,
  name: deployTarget.executorDatabaseName,
  adopt: true,
})

const executorBlobs = await R2Bucket(deployTarget.executorBlobsId, {
  ...cloudflareApiOptions,
  name: deployTarget.executorBlobsBucket,
  adopt: true,
  empty: deployTarget.emptyBucketsOnDestroy,
})

const executorMcpSession = DurableObjectNamespace(
  `${deployTarget.workerId}-executor-mcp-session`,
  {
    className: 'ExecutorMcpSession',
    sqlite: true,
  },
)
const executorExecutionOwnerDirectory = DurableObjectNamespace(
  `${deployTarget.workerId}-executor-owner-directory`,
  {
    className: 'ExecutorMcpExecutionOwnerDirectory',
    sqlite: true,
  },
)

/**
 * Use Cloudflare's version-matched prebuilt Sandbox image in every deployment
 * environment. Alchemy receives a complete Container resource, so it can create
 * or adopt the Container Application and preserve the Sandbox binding without
 * requiring Docker inside Workers Builds.
 */
const sandbox = await Container(deployTarget.sandboxId, {
  ...cloudflareApiOptions,
  className: 'Sandbox',
  name: deployTarget.sandboxName,
  image: SANDBOX_IMAGE,
  instanceType: 'lite',
  maxInstances: 4,
  adopt: true,
})

const agentDo = DurableObjectNamespace(deployTarget.agentDoId, {
  className: 'AgentDO',
  sqlite: true,
})

const automationTrigger = DurableObjectNamespace(
  deployTarget.automationTriggerId,
  {
    className: 'AutomationTriggerDO',
    sqlite: true,
  },
)

/**
 * Receives sampled execution events from staging without introducing runtime
 * secrets. This must deploy during push-to-deploy too; otherwise source changes
 * can leave the dashboard Worker on an older ad hoc probe script while the
 * producer keeps sending events to it.
 */
const tailConsumer = await Worker(deployTarget.tailWorkerId, {
  ...cloudflareApiOptions,
  name: deployTarget.tailWorkerName,
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

export const web = await TanStackStart(deployTarget.workerId, {
  ...cloudflareApiOptions,
  name: deployTarget.workerName,
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
  // Alchemy owns the deployed cron. The reconciler performs ledger cleanup
  // without a durable deadline, so a 12-hour cadence avoids unnecessary
  // database wakeups while still repairing stale product state.
  crons: ['0 */12 * * *'],
  tailConsumers: [tailConsumer],
  // Alchemy owns the production build environment. PostHog is required for
  // Garden deploys, so missing analytics or source-map credentials should fail
  // here with a clear configuration error instead of silently shipping an
  // uninstrumented Worker.
  build: {
    env: postHogBuildEnv(),
  },
  bindings: {
    AgentDO: agentDo,
    Sandbox: sandbox,
    AUTOMATION_TRIGGER: automationTrigger,
    EXECUTOR_DB: executorDatabase,
    EXECUTOR_BLOBS: executorBlobs,
    EXECUTOR_MCP_SESSION: executorMcpSession,
    EXECUTOR_MCP_EXECUTION_OWNER: executorExecutionOwnerDirectory,
    EXECUTOR_SECRET_KEY: alchemy.secret.env.EXECUTOR_SECRET_KEY,
    RUN_WORKFLOW: Workflow(deployTarget.workflowId, {
      workflowName: deployTarget.workflowName,
      className: 'RunWorkflow',
    }),
    MAIL_DELIVERY_WORKFLOW: Workflow(deployTarget.mailWorkflowId, {
      workflowName: deployTarget.mailWorkflowName,
      className: 'MailDeliveryWorkflow',
    }),
    GMAIL_IMPORT_WORKFLOW: Workflow(deployTarget.gmailImportWorkflowId, {
      workflowName: deployTarget.gmailImportWorkflowName,
      className: 'GmailImportWorkflow',
    }),
    FILES: files,
    HYPERDRIVE: database,
    DATABASE_URL: alchemy.secret.env.DATABASE_URL,
    BETTER_AUTH_SECRET: alchemy.secret.env.BETTER_AUTH_SECRET,
    RESEND_API_KEY: alchemy.secret.env.RESEND_API_KEY,
    EXA_API_KEY: alchemy.secret.env.EXA_API_KEY,
    LOADER: WorkerLoader(),
    BROWSER: BrowserRendering(),
    AI: Ai(),
    EMAIL: EmailSender({ dev: { remote: true } }),
    AI_GATEWAY_ID: plainEnv('AI_GATEWAY_ID', deployTarget.aiGatewayId),
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
    GOOGLE_CLIENT_SECRET: alchemy.secret.env.GOOGLE_CLIENT_SECRET,
    ...optionalSecretBindings([
      'CLOUDFLARE_MAIL_API_TOKEN',
      'GITHUB_CLIENT_SECRET',
      'GITHUB_APP_PRIVATE_KEY',
      'GITHUB_WEBHOOK_SECRET',
      'SLACK_CLIENT_SECRET',
    ]),
    ...optionalPlainBindings(['CLOUDFLARE_MAIL_API_BASE_URL']),
  },
  dev: {
    command: 'pnpm exec vite dev',
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
 * Keeps Alchemy account selection aligned with Wrangler. Cloudflare docs allow
 * either wrangler.jsonc `account_id` or CLOUDFLARE_ACCOUNT_ID; Garden uses the
 * env var so local dev, CI, Alchemy, and Wrangler share one account source.
 */
function cloudflareAccountIdFromEnv() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  if (accountId) return accountId

  throw new Error(
    'Missing CLOUDFLARE_ACCOUNT_ID. Set it in the shell, CI environment, or root .env so Alchemy and Wrangler target the same Cloudflare account.',
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
      scriptName: deployTarget.stateWorkerName,
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

function postHogBuildHost() {
  return process.env.POSTHOG_HOST ?? plainEnv('VITE_PUBLIC_POSTHOG_HOST')
}

/**
 * Supplies PostHog source-map upload credentials only to the Alchemy build
 * process. Runtime gets the public Vite token/host bindings above; the personal
 * API key is not attached as a Worker binding. PostHog is a required production
 * dependency for Garden, so deploys should fail fast if the Alchemy environment
 * is missing the CLI upload key or project ID. `GARDEN_REQUIRE_POSTHOG=1` also tells
 * vite.config.ts to fail if someone bypasses this helper and runs an Alchemy
 * build without the required values. References: Alchemy Website build.env docs
 * and PostHog Vite source-map upload docs.
 */
function postHogBuildEnv() {
  const releaseVersion =
    process.env.POSTHOG_RELEASE_VERSION ?? process.env.WORKERS_CI_COMMIT_SHA

  return {
    GARDEN_REQUIRE_POSTHOG: '1',
    POSTHOG_CLI_API_KEY: plainEnv('POSTHOG_CLI_API_KEY'),
    POSTHOG_CLI_PROJECT_ID: plainEnv('POSTHOG_CLI_PROJECT_ID'),
    POSTHOG_CLI_SOURCEMAP_UPLOAD_CONCURRENCY: plainEnv(
      'POSTHOG_CLI_SOURCEMAP_UPLOAD_CONCURRENCY',
      '20',
    ),
    POSTHOG_HOST: postHogBuildHost(),
    ...(releaseVersion ? { POSTHOG_RELEASE_VERSION: releaseVersion } : {}),
  }
}
