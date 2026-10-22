import { describe, expect, it } from 'vitest'
import {
  agentSandboxId,
  isTerminalSubmissionStatus,
  objectOrNull,
  operationFailedMessage,
} from './runtime-utils'

describe('agentSandboxId', () => {
  it('uses the joined facet path when it fits', () => {
    expect(
      agentSandboxId({
        selfPath: [{ name: 'agent-1' }, { name: 'issue-2' }],
        parentPath: [{ name: 'agent-1' }],
        name: 'issue-2',
      }),
    ).toBe('agent-1-issue-2')
  })

  it('falls back to the agent name when there is no facet path', () => {
    expect(agentSandboxId({ selfPath: [], parentPath: [], name: 'solo' })).toBe(
      'solo',
    )
  })

  it('compacts long paths to parent, name and a stable hash', () => {
    const parent = 'Workspace_Agent_With_A_Very_Long_Name'
    const name = '0b9a3f8e-6a3c-4f63-9f43-8cbd1b1f6c11'
    const id = agentSandboxId({
      selfPath: [{ name: parent }, { name }],
      parentPath: [{ name: parent }],
      name,
    })

    expect(id.length).toBeLessThanOrEqual(63)
    expect(id).toMatch(/^workspace-agent-with-0b9a3f8e-6a3c-4f63-9-[0-9a-f]+$/)
    expect(
      agentSandboxId({
        selfPath: [{ name: parent }, { name }],
        parentPath: [{ name: parent }],
        name,
      }),
    ).toBe(id)
  })
})

describe('runtime helpers', () => {
  it('recognises terminal Think submission statuses', () => {
    expect(isTerminalSubmissionStatus('completed')).toBe(true)
    expect(isTerminalSubmissionStatus('error')).toBe(true)
    expect(isTerminalSubmissionStatus('running')).toBe(false)
  })

  it('formats operation failures with the cause message', () => {
    expect(operationFailedMessage('load run', new Error('boom'))).toBe(
      'load run failed: boom',
    )
    expect(operationFailedMessage('load run', 'plain')).toBe(
      'load run failed: plain',
    )
  })

  it('only returns plain objects from objectOrNull', () => {
    expect(objectOrNull({ a: 1 })).toEqual({ a: 1 })
    expect(objectOrNull([1])).toBeNull()
    expect(objectOrNull('x')).toBeNull()
    expect(objectOrNull(null)).toBeNull()
  })
})
