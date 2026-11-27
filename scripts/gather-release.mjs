#!/usr/bin/env node
/**
 * Lists every pull request merged into `dev` that has not reached `main`, so a
 * maintainer can draft release notes from the real merge record.
 *
 * Usage: node gather-release.mjs [base=origin/main] [head=origin/dev] > prs.json
 * Run from a Garden checkout with `gh` authenticated. It fetches both refs,
 * walks the first-parent log, reads `#N` from merge and squash subjects, and
 * prints a JSON array. Commits with no PR number are printed under `direct`.
 */
import { execFileSync } from 'node:child_process'

const [base = 'origin/main', head = 'origin/dev'] = process.argv.slice(2)
const repo = 'Flow-Research/garden'
const run = (cmd, args) =>
  execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20 })

run('git', [
  'fetch',
  '-q',
  'origin',
  base.replace('origin/', ''),
  head.replace('origin/', ''),
])
const lines = run('git', [
  'log',
  '--first-parent',
  '--format=%h\t%ad\t%s',
  '--date=short',
  `${base}..${head}`,
])
  .trim()
  .split('\n')
  .filter(Boolean)

const prs = []
const direct = []
for (const line of lines) {
  const [sha, date, subject] = line.split('\t')
  const match =
    subject.match(/Merge pull request #(\d+)/) ??
    subject.match(/\(#(\d+)\)\s*$/)
  if (!match) {
    direct.push({ sha, date, subject })
    continue
  }
  const pr = JSON.parse(
    run('gh', [
      'pr',
      'view',
      match[1],
      '--repo',
      repo,
      '--json',
      'number,title,body,author,mergedAt,labels,baseRefName',
    ]),
  )
  prs.push({
    number: pr.number,
    title: pr.title,
    author: pr.author.login,
    mergedAt: pr.mergedAt,
    base: pr.baseRefName,
    labels: pr.labels.map((l) => l.name),
    body: pr.body,
  })
}
console.log(
  JSON.stringify({ base, head, count: prs.length, prs, direct }, null, 2),
)
