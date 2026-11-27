import { spawnSync } from 'node:child_process'
import { databaseEnvForTarget, deploymentTargets } from '../deploy-targets.mjs'

/**
 * Deploys garden-dev against its own Neon branch. Before: dev skipped
 * migrations because it shared staging's DATABASE_URL. After: DEV_DATABASE_URL
 * is required, becomes DATABASE_URL for this process tree, and migrations run
 * first; a failed migration stops the deploy, matching the staging script.
 */
const env = databaseEnvForTarget(deploymentTargets.dev)
for (const script of ['deploy:migrate', 'deploy:dev:alchemy']) {
  const result = spawnSync('pnpm', ['run', script], { stdio: 'inherit', env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
