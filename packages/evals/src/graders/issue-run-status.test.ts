import assert from 'node:assert/strict'
import { it } from 'node:test'
import { issueRunTaskExample } from '../examples/issue-run-task.ts'
import { createIssueRunEvidence } from '../evidence/issue-run.ts'
import { evalConfigurationSchema, type IssueRunStatus } from '../index.ts'
import type { GardenIssueRunResponse } from '../runner/garden-api.ts'
import { createTrialIdentity } from '../runner/issue-run.ts'
import { gradeIssueRunStatus, prepareIssueRunTask } from './issue-run-status.ts'

const issueId = '00000000-0000-4000-8000-000000000001'
const runId = '00000000-0000-4000-8000-000000000002'
const workspaceId = '00000000-0000-4000-8000-000000000003'
const configuration = evalConfigurationSchema.parse({
  baseUrl: 'http://localhost:3000/',
  workspaceId,
  agentId: '00000000-0000-4000-8000-000000000004',
  deadlineMs: 1000,
  pollIntervalMs: 100,
})
const identity = createTrialIdentity({
  taskId: issueRunTaskExample.taskId,
  taskVersion: issueRunTaskExample.version,
})

function grade(status: IssueRunStatus) {
  const prepared = prepareIssueRunTask(issueRunTaskExample).match({
    ok: (value) => value,
    err: (error) => assert.fail(error.message),
  })
  const now = new Date().toISOString()
  const run: GardenIssueRunResponse['run'] = {
    id: runId,
    issue_id: issueId,
    workspace_id: workspaceId,
    status,
    usage: null,
    started_at: now,
    finished_at: status === 'running' ? null : now,
    created_at: now,
    updated_at: now,
  }
  return gradeIssueRunStatus({
    task: prepared,
    identity,
    configuration,
    issueId,
    run,
    evidence: createIssueRunEvidence({
      identity,
      requiredSources: ['issue_run'],
      run,
    }),
  })
}

it('keeps live issue runs invalid instead of grading them as failed', () => {
  const result = grade('running')
  assert.equal(result.isErr(), true)
  result.match({
    ok: () => assert.fail('Expected invalid evidence'),
    err: (error) => assert.equal(error.code, 'non_terminal_run'),
  })
})

it('grades terminal issue runs from their stored status', () => {
  assert.equal(
    grade('succeeded').match({
      ok: (report) => report.outcome,
      err: (error) => assert.fail(error.message),
    }),
    'passed',
  )
  assert.equal(
    grade('failed').match({
      ok: (report) => report.outcome,
      err: (error) => assert.fail(error.message),
    }),
    'failed',
  )
})
