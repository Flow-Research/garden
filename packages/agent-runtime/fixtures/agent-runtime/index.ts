import process from 'node:process'
import { callAgentRuntimeFixture, type FixtureTarget } from './client.ts'
import { resolveFixtureWorkspace } from './db.ts'
import { createFixtureLogger } from './logger.ts'

function arg(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const fixtureTargets = [
  'chat',
  'issue-run',
  'issue-run-work',
  'automation-run',
  'automation-schedule',
] as const

/**
 * Provides safe default prompts for live runtime fixtures. The issue-run-work
 * fixture covers the successful work-product path so smoke tests do useful
 * lightweight work instead of only proving the blocked terminal branch.
 */
function defaultFixtureMessage(target: FixtureTarget) {
  if (target === 'issue-run-work') {
    return [
      'For this live fixture, create a concise checklist work product titled "Runtime smoke checklist".',
      'Use create_work_product exactly once with type checklist.',
      'The body should contain three short bullets confirming the runtime can plan, use tools, and finish.',
      'Do not use external systems.',
    ].join(' ')
  }
  if (target === 'automation-run' || target === 'automation-schedule') {
    return 'For this live fixture, immediately complete the automation with output: runtime smoke test complete. Do not use external systems.'
  }
  return 'Inspect Garden runtime readiness and do not modify external systems.'
}

const target = (arg('--target') ?? 'chat') as FixtureTarget
if (!(fixtureTargets as readonly string[]).includes(target)) {
  throw new Error(`--target must be ${fixtureTargets.join(', ')}`)
}
const mode = process.argv.includes('--run') ? 'run' : 'inspect'
const message = arg('--message') ?? defaultFixtureMessage(target)
const messages = process.argv
  .map((value, index) => (value === '--turn' ? process.argv[index + 1] : null))
  .filter((value): value is string => Boolean(value))
const logPath =
  arg('--log') ??
  `artifacts/fixtures/agent-runtime/${new Date().toISOString().replace(/[:.]/g, '-')}-${target}.jsonl`
const logger = createFixtureLogger(logPath)
logger.write('start', { target, mode, message, messages })

const workspace = await resolveFixtureWorkspace()
logger.write('workspace', workspace)
const data = await callAgentRuntimeFixture({
  ...workspace,
  target,
  mode,
  ...(messages.length > 0 ? { messages } : { message }),
})
logger.write('result', data)
console.log(JSON.stringify({ ...data, logPath }, null, 2))

if (target === 'chat') {
  if (!data.hasGithubRepoSearchTool) {
    throw new Error(
      'tool_github_search_repositories is not exposed to the chat agent',
    )
  }
  if (!data.hasGithubRoutingPrompt) {
    throw new Error(
      'GitHub repository routing prompt is missing from chat agent',
    )
  }
  const slashSkills = Array.from(
    new Set(
      message
        .split(/\s+/)
        .flatMap((token) => /^\/([a-zA-Z0-9_-]+)$/.exec(token)?.[1] ?? []),
    ),
  )
  if (mode === 'run' && slashSkills.length > 0) {
    const loadedSkillKeys = Array.isArray(data.afterTurn?.loadedSkillKeys)
      ? data.afterTurn.loadedSkillKeys
      : []
    for (const slug of slashSkills) {
      if (
        !loadedSkillKeys.includes(slug) &&
        !loadedSkillKeys.includes(`skills:${slug}`)
      ) {
        throw new Error(`slash skill ${slug} was not loaded in runtime`)
      }
    }
  }
}
