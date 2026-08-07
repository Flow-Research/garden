import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deploymentTargets } from '../deploy-targets.mjs'

const root = resolve(import.meta.dirname, '..')
const alchemySource = readFileSync(resolve(root, 'alchemy.run.ts'), 'utf8')
const packageJson = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
)
const webPackageJson = JSON.parse(
  readFileSync(resolve(root, 'apps/web/package.json'), 'utf8'),
)
const viteSource = readFileSync(
  resolve(root, 'apps/web/vite.config.ts'),
  'utf8',
)
const workspaceSource = readFileSync(
  resolve(root, 'pnpm-workspace.yaml'),
  'utf8',
)
const sandboxVersion = workspaceSource.match(
  /^\s+"@cloudflare\/sandbox":\s+"([^"]+)"$/m,
)?.[1]
const sandboxImage = `docker.io/cloudflare/sandbox:${sandboxVersion}-python`

assert.deepEqual(Object.keys(deploymentTargets), ['production', 'preview'])
assert.equal(deploymentTargets.production.workerName, 'garden-staging')
assert.equal(deploymentTargets.preview.workerName, 'garden-preview')
assert.equal(deploymentTargets.production.emptyBucketsOnDestroy, false)
assert.equal(deploymentTargets.preview.emptyBucketsOnDestroy, true)
assert.equal(deploymentTargets.preview.databaseUrlEnv, 'DATABASE_URL')
assert.equal(deploymentTargets.preview.bindConfiguredBetterAuthUrl, false)

const uniqueFields = [
  'appName',
  'workerId',
  'workerName',
  'tailWorkerId',
  'tailWorkerName',
  'filesId',
  'filesBucket',
  'databaseId',
  'databaseName',
  'executorDatabaseId',
  'executorDatabaseName',
  'executorBlobsId',
  'executorBlobsBucket',
  'agentDoId',
  'automationTriggerId',
  'workflowId',
  'workflowName',
  'sandboxId',
  'sandboxName',
  'stateWorkerName',
]

for (const field of uniqueFields) {
  const values = Object.values(deploymentTargets).map((target) => target[field])
  assert.equal(
    new Set(values).size,
    values.length,
    `deployment targets must not share ${field}`,
  )
  for (const value of values) {
    assert.equal(typeof value, 'string', `${field} must be a string`)
    assert.notEqual(value.length, 0, `${field} must not be empty`)
  }
}

for (const binding of [
  'AgentDO',
  'Sandbox',
  'AUTOMATION_TRIGGER',
  'EXECUTOR_DB',
  'EXECUTOR_BLOBS',
  'EXECUTOR_MCP_SESSION',
  'EXECUTOR_MCP_EXECUTION_OWNER',
  'RUN_WORKFLOW',
  'FILES',
  'HYPERDRIVE',
  'LOADER',
  'BROWSER',
  'AI',
]) {
  assert.match(
    alchemySource,
    new RegExp(`\\b${binding}\\s*:`),
    `Alchemy must declare ${binding}`,
  )
}

for (const field of [
  'workerName',
  'tailWorkerName',
  'filesBucket',
  'databaseName',
  'executorDatabaseName',
  'executorBlobsBucket',
  'workflowName',
  'sandboxName',
  'stateWorkerName',
]) {
  assert.match(
    alchemySource,
    new RegExp(`deployTarget\\.${field}`),
    `Alchemy must select ${field} from target metadata`,
  )
}

assert.equal(sandboxVersion, '0.12.4')
assert.match(alchemySource, /const SANDBOX_IMAGE = '[^']+'/)
assert.match(alchemySource, new RegExp(sandboxImage.replaceAll('.', '\\.')))
assert.doesNotMatch(alchemySource, /existingSandboxBinding/)
assert.doesNotMatch(alchemySource, /process\.env\.WORKERS_CI\s*\?/)
assert.match(alchemySource, /image:\s*SANDBOX_IMAGE/)
assert.match(alchemySource, /SANDBOX_TRANSPORT[^\n]+rpc/)
assert.match(alchemySource, /empty:\s*deployTarget\.emptyBucketsOnDestroy/)
assert.match(alchemySource, /deploymentTargetFromEnv\(\)/)
assert.equal(webPackageJson.devDependencies['@posthog/cli'], '0.8.4')
assert.equal(packageJson.pnpm.overrides['@posthog/cli'], '0.8.4')
assert.match(alchemySource, /POSTHOG_CLI_SOURCEMAP_UPLOAD_CONCURRENCY/)
assert.match(alchemySource, /WORKERS_CI_COMMIT_SHA/)
assert.match(viteSource, /WORKERS_CI_COMMIT_SHA/)
assert.match(viteSource, /batchSize:\s*100/)
assert.match(viteSource, /deleteAfterUpload:\s*true/)
assert.match(
  packageJson.scripts['deploy:alchemy'],
  /GARDEN_DEPLOY_TARGET=production/,
)
assert.match(
  packageJson.scripts['deploy:preview:alchemy'],
  /GARDEN_DEPLOY_TARGET=preview/,
)
assert.match(
  packageJson.scripts['destroy:preview'],
  /GARDEN_DEPLOY_TARGET=preview/,
)

console.log(
  'deploy config passed: garden-staging and garden-preview are isolated Alchemy targets',
)
