import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diagramFailures } from './diagram-contract.mjs'

const manifest = {
  diagrams: {
    'garden-issue-run': {
      title: 'Garden run and context',
      watches: ['packages/agent-runtime/src/run-workflow.ts'],
    },
    'garden-member-connector': {
      title: 'Member connector access',
      watches: ['apps/web/src/lib/server/executor-engine/'],
    },
  },
}
const workflow = 'packages/agent-runtime/src/run-workflow.ts'
const check = (files, body = '') => diagramFailures({ files, body, manifest })

test('changes outside watched paths need no diagram', () => {
  assert.deepEqual(check(['apps/web/src/routes/index.tsx']), [])
})

test('watched change without its diagram fails and names both ways out', () => {
  const failures = check([workflow])
  assert.equal(failures.length, 1)
  assert.match(failures[0], /garden-issue-run/)
  assert.match(failures[0], /run-workflow\.ts/)
  assert.match(failures[0], /docs\/diagrams\/garden-issue-run\.drawio\.svg/)
  assert.match(failures[0], /Diagrams: not affected/)
})

test('directory prefixes match files below them', () => {
  const failures = check(['apps/web/src/lib/server/executor-engine/engine.ts'])
  assert.match(failures[0], /garden-member-connector/)
})

test('watched change with its diagram updated passes', () => {
  assert.deepEqual(
    check([workflow, 'docs/diagrams/garden-issue-run.drawio.svg']),
    [],
  )
})

test('stated reason in the body passes', () => {
  assert.deepEqual(
    check([workflow], 'Diagrams: not affected — renames a local variable'),
    [],
  )
})

test('excuse without a reason still fails', () => {
  assert.equal(check([workflow], 'Diagrams: not affected').length, 1)
})

test('a sentence that quotes the excuse mid-line does not excuse', () => {
  const checkbox =
    '- [ ] I updated the diagrams in `docs/diagrams/` that this change affects, or\n' +
    '      wrote `Diagrams: not affected` with a reason.'
  assert.equal(check([workflow], checkbox).length, 1)
})
