/**
 * Alchemy deployment metadata. Remote targets share one application shape while
 * keeping every Cloudflare resource independently named and destructible.
 */
export const deploymentTargets = {
  staging: {
    key: 'staging',
    branch: 'main',
    // Alchemy v2 already owns staging under this stack/stage pair. Renaming
    // the product target must not create a second owner for existing resources.
    stackName: 'garden-production',
    stage: 'production',
    workerId: 'web',
    workerName: 'garden-staging',
    tailWorkerId: 'tail',
    tailWorkerName: 'garden-staging-tail',
    filesId: 'files',
    filesBucket: 'garden-files-staging',
    brainFilesId: 'brain-files',
    brainFilesBucket: 'org-brain',
    databaseId: 'database',
    databaseName: 'garden-database-staging',
    databaseUrlEnv: 'DATABASE_URL',
    executorDatabaseId: 'executor-connectors-db',
    // Cloudflare storage resource names are immutable deployment identifiers;
    // keep the adopted names while the application-facing bindings use Executor.
    executorDatabaseName: 'harnessy-connectors',
    executorBlobsId: 'executor-blobs',
    executorBlobsBucket: 'harnessy-connectors-blobs',
    agentDoId: 'agent-do',
    // The v1 Worker tag stored the runtime binding name `AUTOMATION_TRIGGER`
    // as the class for logical ID `automation-trigger`. Use the binding name as
    // the v2 logical ID so adoption matches the observed `AutomationTriggerDO`
    // class instead of asking Cloudflare to rename a non-existent class.
    automationTriggerId: 'AUTOMATION_TRIGGER',
    workflowId: 'run-workflow',
    workflowName: 'garden-run-workflow-staging',
    sandboxId: 'sandbox',
    sandboxName: 'garden-web-sandbox-staging',
    aiGatewayId: 'garden-staging',
    environment: 'production',
    emptyBucketsOnDestroy: false,
  },
  dev: {
    key: 'dev',
    branch: 'dev',
    stackName: 'garden-dev',
    stage: 'dev',
    workerId: 'web-dev',
    workerName: 'garden-dev',
    tailWorkerId: 'tail-dev',
    tailWorkerName: 'garden-dev-tail',
    filesId: 'files-dev',
    filesBucket: 'garden-files-dev',
    brainFilesId: 'brain-files-dev',
    brainFilesBucket: 'org-brain-dev',
    databaseId: 'database-dev',
    databaseName: 'garden-database-dev',
    // Dev uses the configured Postgres origin; only staging runs migrations.
    // Cloudflare resources and Executor storage remain independently owned.
    databaseUrlEnv: 'DATABASE_URL',
    executorDatabaseId: 'executor-connectors-db-dev',
    executorDatabaseName: 'harnessy-connectors-dev',
    executorBlobsId: 'executor-blobs-dev',
    executorBlobsBucket: 'harnessy-connectors-blobs-dev',
    agentDoId: 'agent-do-dev',
    // Match the runtime binding name for newly provisioned Durable Objects.
    automationTriggerId: 'AUTOMATION_TRIGGER',
    workflowId: 'run-workflow-dev',
    workflowName: 'garden-run-workflow-dev',
    sandboxId: 'sandbox-dev',
    sandboxName: 'garden-web-sandbox-dev',
    aiGatewayId: 'garden-dev',
    environment: 'development',
    emptyBucketsOnDestroy: false,
  },
  preview: {
    key: 'preview',
    branch: null,
    stackName: 'garden-preview',
    stage: 'preview',
    workerId: 'web-preview',
    workerName: 'garden-preview',
    tailWorkerId: 'tail-preview',
    tailWorkerName: 'garden-preview-tail',
    filesId: 'files-preview',
    filesBucket: 'garden-files-preview',
    brainFilesId: 'brain-files-preview',
    brainFilesBucket: 'org-brain-preview',
    databaseId: 'database-preview',
    databaseName: 'garden-database-preview',
    // Explicit temporary compromise: preview shares the live Postgres origin.
    // Cloudflare resources and Executor storage remain isolated.
    databaseUrlEnv: 'DATABASE_URL',
    executorDatabaseId: 'executor-connectors-db-preview',
    executorDatabaseName: 'harnessy-connectors-preview',
    executorBlobsId: 'executor-blobs-preview',
    executorBlobsBucket: 'harnessy-connectors-blobs-preview',
    agentDoId: 'agent-do-preview',
    // The first v2 preview adoption registered this binding under its runtime
    // name. Keep that state identity to avoid a Durable Object class migration.
    automationTriggerId: 'AUTOMATION_TRIGGER',
    workflowId: 'run-workflow-preview',
    workflowName: 'garden-run-workflow-preview',
    sandboxId: 'sandbox-preview',
    sandboxName: 'garden-web-sandbox-preview',
    aiGatewayId: 'garden-preview',
    environment: 'development',
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

/**
 * Workers Builds supplies WORKERS_CI_BRANCH for push and manual builds. Only
 * main and dev select persistent targets; all other branches must use the
 * explicit preview command. See Cloudflare Workers Builds configuration docs.
 */
export function deploymentTargetFromBranch(
  branch = process.env.WORKERS_CI_BRANCH,
) {
  const target = Object.values(deploymentTargets).find(
    (target) => target.branch !== null && target.branch === branch,
  )
  if (target) return target
  throw new Error('Automatic deploys require WORKERS_CI_BRANCH=main or dev')
}
