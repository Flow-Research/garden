/**
 * Alchemy deployment metadata. Remote targets share one application shape while
 * keeping every Cloudflare resource independently named and destructible.
 */
export const deploymentTargets = {
  production: {
    key: 'production',
    appName: 'garden',
    stage: 'staging',
    workerId: 'web',
    workerName: 'garden-staging',
    tailWorkerId: 'tail',
    tailWorkerName: 'garden-staging-tail',
    filesId: 'files',
    filesBucket: 'garden-files-staging',
    databaseId: 'database',
    databaseName: 'garden-database-staging',
    databaseUrlEnv: 'DATABASE_URL',
    executorDatabaseId: 'executor-connectors-db',
    // Cloudflare storage resource names are immutable deployment identifiers;
    // keep the adopted names while the application-facing bindings use Executor.
    executorDatabaseName: 'harnessy-connectors',
    executorDatabaseDelete: true,
    executorBlobsId: 'executor-blobs',
    executorBlobsBucket: 'harnessy-connectors-blobs',
    agentDoId: 'agent-do',
    automationTriggerId: 'automation-trigger',
    workflowId: 'run-workflow',
    workflowName: 'garden-run-workflow-staging',
    mailWorkflowId: 'mail-delivery-workflow',
    mailWorkflowName: 'garden-mail-delivery-staging',
    gmailImportWorkflowId: 'gmail-import-workflow',
    gmailImportWorkflowName: 'garden-gmail-import-staging',
    sandboxId: 'sandbox',
    sandboxName: 'garden-web-sandbox-staging',
    aiGatewayId: 'garden-staging',
    stateWorkerName: 'garden-alchemy-state-staging-v2',
    environment: 'production',
    bindConfiguredBetterAuthUrl: true,
    emptyBucketsOnDestroy: false,
  },
  preview: {
    key: 'preview',
    appName: 'garden-preview',
    stage: 'preview',
    workerId: 'web-preview',
    workerName: 'garden-preview',
    tailWorkerId: 'tail-preview',
    tailWorkerName: 'garden-preview-tail',
    filesId: 'files-preview',
    filesBucket: 'garden-files-preview',
    databaseId: 'database-preview',
    databaseName: 'garden-database-preview',
    // Explicit temporary compromise: preview shares the live Postgres origin
    // and Executor connection D1. All other Cloudflare resources stay isolated.
    databaseUrlEnv: 'DATABASE_URL',
    executorDatabaseId: 'executor-connectors-db-preview',
    // Preview intentionally adopts the existing Executor control-plane D1 so
    // personal OAuth connections are available without reconnecting. Its
    // Alchemy resource must never delete the shared physical database.
    executorDatabaseName: 'harnessy-connectors',
    executorDatabaseDelete: false,
    executorBlobsId: 'executor-blobs-preview',
    executorBlobsBucket: 'harnessy-connectors-blobs-preview',
    agentDoId: 'agent-do-preview',
    automationTriggerId: 'automation-trigger-preview',
    workflowId: 'run-workflow-preview',
    workflowName: 'garden-run-workflow-preview',
    mailWorkflowId: 'mail-delivery-workflow-preview',
    mailWorkflowName: 'garden-mail-delivery-preview',
    gmailImportWorkflowId: 'gmail-import-workflow-preview',
    gmailImportWorkflowName: 'garden-gmail-import-preview',
    sandboxId: 'sandbox-preview',
    sandboxName: 'garden-web-sandbox-preview',
    aiGatewayId: 'garden-preview',
    stateWorkerName: 'garden-alchemy-state-preview',
    // Preview is a remote Worker, so it must exercise the production transport
    // boundary (Hyperdrive, Workflows, Durable Objects). `development` is
    // reserved for local Workerd and deliberately selects direct Neon clients.
    environment: 'staging',
    bindConfiguredBetterAuthUrl: false,
    emptyBucketsOnDestroy: true,
  },
}

export function deploymentTargetFromEnv(
  value = process.env.GARDEN_DEPLOY_TARGET,
) {
  if (value && Object.hasOwn(deploymentTargets, value)) {
    return deploymentTargets[value]
  }
  throw new Error(
    `Set GARDEN_DEPLOY_TARGET to one of: ${Object.keys(deploymentTargets).join(', ')}`,
  )
}
