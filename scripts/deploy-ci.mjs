import { spawnSync } from 'node:child_process'
import {
  deploymentTargetFromBranch,
  deploymentTargets,
} from '../deploy-targets.mjs'

/**
 * Workers Builds uses separate production and non-production triggers. Its
 * non-production trigger accepts every other branch, so skip branches without
 * a persistent target before typechecks or migrations:
 * staging owns shared Postgres migrations; dev only deploys its own resources.
 * Preview remains manual; missing branch metadata still fails configuration.
 * Reference: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
 */
const branch = process.env.WORKERS_CI_BRANCH
if (
  branch &&
  !Object.values(deploymentTargets).some((target) => target.branch === branch)
) {
  console.log(`Skipping automatic deployment for ${branch}`)
  process.exit(0)
}
const target = deploymentTargetFromBranch(branch)
const command = target.key === 'staging' ? 'deploy' : 'deploy:dev'
console.log(`Deploying ${process.env.WORKERS_CI_BRANCH} → ${target.workerName}`)
const result = spawnSync('pnpm', ['run', command], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
