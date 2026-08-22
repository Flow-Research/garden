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
const devSource = readFileSync(
  resolve(root, 'apps/web/scripts/dev.mjs'),
  'utf8',
)
const publicWranglerSources = [
  'apps/web/wrangler.jsonc',
  'apps/web/wrangler.containers.jsonc',
].map((path) => readFileSync(resolve(root, path), 'utf8'))
const gitignoreSource = readFileSync(resolve(root, '.gitignore'), 'utf8')
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

assert.match(publicWranglerSources[0], /"name": "garden-staging"/)
assert.match(publicWranglerSources[1], /"name": "garden-local"/)

for (const source of publicWranglerSources) {
  assert.match(source, /"id": "0{32}"/)
  assert.match(source, /"database_id": "00000000-0000-0000-0000-000000000000"/)
  assert.equal(
    [...source.matchAll(/"id": "([a-f0-9]{32})"/g)].every((match) =>
      /^0+$/.test(match[1]),
    ),
    true,
  )
  assert.equal(
    [...source.matchAll(/"database_id": "([a-f0-9-]{36})"/g)].every((match) =>
      /^0+$/.test(match[1].replaceAll('-', '')),
    ),
    true,
  )
  assert.doesNotMatch(source, /"tail_consumers"/)
  assert.match(
    source,
    /"ai":\s*\{[^}]*"binding": "AI",[^}]*"remote": true[^}]*\}/,
  )
  assert.equal([...source.matchAll(/"remote": true/g)].length, 1)
}

assert.match(gitignoreSource, /apps\/web\/wrangler\.local\.jsonc/)
assert.match(gitignoreSource, /apps\/web\/wrangler\.containers\.local\.jsonc/)
assert.match(devSource, /wrangler\.containers\.local\.jsonc/)
assert.match(devSource, /wrangler\.local\.jsonc/)
// Remote bindings stay on for the default dev path; only the explicit
// --offline flag may turn them off (the offline mode never touches the
// wrangler configs, so the single AI "remote": true assertions above keep
// guarding the deploy surface).
assert.match(
  devSource,
  /CLOUDFLARE_VITE_REMOTE_BINDINGS = offline \? '0' : '1'/,
)
assert.match(devSource, /const offline = args\.has\('--offline'\)/)
assert.match(
  devSource,
  /useLocalOverlay = containers && existsSync\(localFile\)/,
)
assert.doesNotMatch(devSource, /localOnly|--local\b/)
assert.equal(
  packageJson.scripts.dev,
  'turbo run dev:local --ui=tui --filter=@garden/web',
)
assert.equal(
  packageJson.scripts['dev:offline'],
  'turbo run dev:offline --ui=tui --filter=@garden/web',
)
assert.equal(webPackageJson.scripts['dev:local'], 'node ./scripts/dev.mjs')
assert.equal(
  webPackageJson.scripts['dev:offline'],
  'node ./scripts/dev.mjs --offline',
)

// The deployed model default must remain Workers AI: offline/openai-compatible
// is opt-in via GARDEN_MODEL_PROVIDER / GARDEN_OFFLINE only.
const modelSource = readFileSync(
  resolve(root, 'packages/agent-runtime/src/model.ts'),
  'utf8',
)
assert.match(
  modelSource,
  /DEFAULT_AGENT_MODEL_PROFILE =\s*\n?\s*agentModelProfiles\.kimiK27CodeWorkersAi/,
)
assert.match(
  modelSource,
  /:\s*'workers-ai'\s*\n\s*if \(provider === 'workers-ai'\) return DEFAULT_AGENT_MODEL_PROFILE/,
)

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
assert.match(alchemySource, /optionalSecretBindings\(\['EXA_API_KEY'\]\)/)
assert.match(alchemySource, /image:\s*SANDBOX_IMAGE/)
assert.match(alchemySource, /SANDBOX_TRANSPORT[^\n]+rpc/)
assert.match(
  alchemySource,
  /forceDestroy:\s*deployTarget\.emptyBucketsOnDestroy/,
)
assert.match(alchemySource, /deploymentTargetFromEnv\(\)/)
assert.equal(webPackageJson.devDependencies['@posthog/cli'], '0.8.4')
assert.equal(packageJson.pnpm.overrides['@posthog/cli'], '0.8.4')
assert.equal(webPackageJson.dependencies['@cloudflare/codemode'], 'catalog:')
assert.match(
  viteSource,
  /import codemode from ['"]@cloudflare\/codemode\/vite['"]/,
)
assert.match(viteSource, /\bcodemode\(\),/)
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
