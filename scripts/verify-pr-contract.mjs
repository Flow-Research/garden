import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const REQUIRED_HEADINGS = [
  '## What changed',
  '## Why',
  '## Scope',
  '## Contribution standard',
  '## Documentation',
  '## Checks',
  '## Verification',
  '## Risk and follow-up',
]

const CHECKED_ITEMS = [
  'I stated the outcome and non-goals.',
  'I read `docs/README.md` and the relevant code, tests, and documentation',
  'I reviewed the final diff and considered its wider effects.',
]

const BEHAVIOR_PATHS = [
  'apps/',
  'packages/',
  'workers/',
  'scripts/',
  'alchemy.run.ts',
  'deploy-targets.mjs',
]

const DOCUMENTATION_PATHS = [
  'docs/',
  '.agents/skills/',
  'AGENTS.md',
  'CONTRIBUTING.md',
]

/**
 * Escape a string before using it as a regular-expression pattern.
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Return the content below one level-two Markdown heading.
 */
function sectionBody(body, heading) {
  const headingPattern = new RegExp(`^${escapeRegExp(heading)}\\s*$`, 'm')
  const headingMatch = headingPattern.exec(body)
  if (!headingMatch) return ''

  const start = headingMatch.index + headingMatch[0].length
  const nextHeading = /^##\s+/m.exec(body.slice(start))
  const end = nextHeading ? start + nextHeading.index : body.length
  return body
    .slice(start, end)
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
}

/**
 * Check whether a PR body contains one checked checklist item.
 */
function hasCheckedItem(body, item) {
  const itemPattern = new RegExp(
    `^\\s*- \\[x\\]\\s+${escapeRegExp(item)}`,
    'im',
  )
  return itemPattern.test(body)
}

/**
 * Read changed paths from the checked-out base and head commits.
 */
function changedFiles(baseSha, headSha) {
  const result = spawnSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMRT', baseSha, headSha],
    { encoding: 'utf8' },
  )

  if (result.status !== 0) {
    fail(
      `could not read the PR diff between ${baseSha} and ${headSha}`,
      result.stderr?.trim(),
    )
    return []
  }

  const output = result.stdout.trim()
  return output ? output.split('\n') : []
}

/**
 * Write one contract failure in a consistent format.
 */
function fail(...messages) {
  for (const message of messages.filter(Boolean)) {
    process.stderr.write(`- ${message}\n`)
  }
  process.exitCode = 1
}

/**
 * Print the command usage text.
 */
function writeUsage() {
  process.stdout.write(
    'Usage: pnpm verify:pr [--event <path>]\n' +
      'Checks the pull-request contract used by Garden CI.\n',
  )
}

/**
 * Run the pull-request contract checks against the GitHub event payload.
 */
function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    writeUsage()
    return
  }

  const eventFlagIndex = args.indexOf('--event')
  const eventPath =
    eventFlagIndex >= 0
      ? args[eventFlagIndex + 1]
      : process.env.GITHUB_EVENT_PATH

  if (!eventPath) {
    fail('GITHUB_EVENT_PATH is missing; run this check in a pull-request job')
    return
  }

  const event = JSON.parse(readFileSync(eventPath, 'utf8'))
  const pullRequest = event.pull_request
  if (!pullRequest) {
    if (event.ref) {
      process.stdout.write(
        'PR contract is not applicable to a push event; branch status recorded.\n',
      )
      return
    }
    fail('the GitHub event is not a pull_request event')
    return
  }

  const failures = []
  const baseRef = pullRequest.base?.ref
  const headRef = pullRequest.head?.ref
  const title = pullRequest.title?.trim() ?? ''
  const body = pullRequest.body ?? ''

  if (baseRef !== 'dev' && !(baseRef === 'main' && headRef === 'dev')) {
    failures.push(
      `base branch must be dev, or main from dev; received ${baseRef ?? 'missing'}`,
    )
  }

  if (title.length < 10) {
    failures.push('PR title must contain at least 10 characters')
  }

  if (!pullRequest.draft) {
    for (const heading of REQUIRED_HEADINGS) {
      if (!sectionBody(body, heading)) {
        failures.push(`PR body needs a non-empty section: ${heading}`)
      }
    }

    for (const item of CHECKED_ITEMS) {
      if (!hasCheckedItem(body, item)) {
        failures.push(`PR body needs this checked item: ${item}`)
      }
    }

    const documentation = sectionBody(body, '## Documentation')
    if (
      !/documentation:\s*(not needed|not required)\b/i.test(documentation) &&
      !/\[[xX]\].*(feature doc|architecture|design|verification|maintainer|workflow)/i.test(
        documentation,
      )
    ) {
      failures.push(
        'Documentation section must name updated docs or explain why documentation is not needed',
      )
    }

    const checks = sectionBody(body, '## Checks')
    if (!/`[^`]+`|\b(pnpm|npm|yarn|bun|git)\s+\S+/i.test(checks)) {
      failures.push('Checks section must list commands or checks')
    }

    const verification = sectionBody(body, '## Verification')
    if (!/\b(PASS|FAIL|INCONCLUSIVE)\b/i.test(verification)) {
      failures.push(
        'Verification section must state PASS, FAIL, or INCONCLUSIVE',
      )
    }
    if (!/evidence/i.test(verification)) {
      failures.push('Verification section must identify the evidence')
    }

    const files = changedFiles(pullRequest.base?.sha, pullRequest.head?.sha)
    const behaviorChanged = files.some((file) =>
      BEHAVIOR_PATHS.some((path) => file === path || file.startsWith(path)),
    )
    const documentationChanged = files.some((file) =>
      DOCUMENTATION_PATHS.some(
        (path) => file === path || file.startsWith(path),
      ),
    )

    if (
      behaviorChanged &&
      !documentationChanged &&
      !/documentation:\s*(not needed|not required)\b/i.test(documentation)
    ) {
      failures.push(
        'behavior changes need a documentation change or a documented reason that docs are not needed',
      )
    }
  }

  if (failures.length > 0) {
    process.stderr.write('PR contract failed:\n')
    for (const failure of failures) fail(failure)
    return
  }

  if (pullRequest.draft) {
    process.stdout.write(
      'PR contract passed for this draft; full body checks run when it is ready for review.\n',
    )
    return
  }

  process.stdout.write('PR contract passed.\n')
}

main()
