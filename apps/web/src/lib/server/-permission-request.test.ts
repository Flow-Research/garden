import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveConnectorWritePermissionRequests } from './permission-request'

function chainableTerminal(rows: unknown[]) {
  return {
    where: vi.fn(() => Promise.resolve(rows)),
  }
}

describe('resolveConnectorWritePermissionRequests audit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes an approved audit row when the resolution approves', async () => {
    const toolCallId = 'tool-call-1'
    const referenceRow = {
      id: 'request-1',
      agentId: 'agent-1',
      capabilityId: 'capability-1',
      argsJson: { comment: 'hello' },
      issueId: null,
      toolCallId,
    }
    const insertedValues: unknown[] = []
    let selectCalls = 0

    const db = {
      select: vi.fn(() => {
        selectCalls += 1
        if (selectCalls === 1) {
          return {
            from: vi.fn(() => ({
              innerJoin: vi.fn(() => ({
                where: vi.fn(() => ({
                  limit: vi.fn(() => Promise.resolve([referenceRow])),
                })),
              })),
            })),
          }
        }
        return {
          from: vi.fn(() => chainableTerminal([referenceRow])),
        }
      }),
      transaction: vi.fn(
        async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => {
          const tx = {
            update: () => ({
              set: () => ({
                where: () => ({
                  returning: () =>
                    Promise.resolve([
                      {
                        argsJson: referenceRow.argsJson,
                        capabilityId: referenceRow.capabilityId,
                        toolCallId,
                      },
                    ]),
                }),
              }),
            }),
            insert: () => ({
              values: (rows: unknown) => {
                insertedValues.push(rows)
                return Promise.resolve()
              },
            }),
          }
          return fn(tx)
        },
      ),
    }

    const result = await resolveConnectorWritePermissionRequests({
      approved: true,
      actorUserId: 'user-1',
      db: db as never,
      toolCallId,
      workspaceId: 'workspace-1',
    })

    expect(result.isOk()).toBe(true)
    expect(insertedValues).toHaveLength(1)
    expect(insertedValues[0]).toEqual([
      expect.objectContaining({
        workspaceId: 'workspace-1',
        agentId: 'agent-1',
        capabilityId: 'capability-1',
        toolCallId,
        resultStatus: 'approved',
        error: null,
      }),
    ])
  })

  it('writes a denied audit row when the resolution denies', async () => {
    const toolCallId = 'tool-call-2'
    const referenceRow = {
      id: 'request-2',
      agentId: 'agent-2',
      capabilityId: 'capability-2',
      argsJson: { comment: 'bye' },
      issueId: null,
      toolCallId,
    }
    const insertedValues: unknown[] = []
    let selectCalls = 0

    const db = {
      select: vi.fn(() => {
        selectCalls += 1
        if (selectCalls === 1) {
          return {
            from: vi.fn(() => ({
              innerJoin: vi.fn(() => ({
                where: vi.fn(() => ({
                  limit: vi.fn(() => Promise.resolve([referenceRow])),
                })),
              })),
            })),
          }
        }
        return {
          from: vi.fn(() => chainableTerminal([referenceRow])),
        }
      }),
      transaction: vi.fn(
        async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => {
          const tx = {
            update: () => ({
              set: () => ({
                where: () => ({
                  returning: () =>
                    Promise.resolve([
                      {
                        argsJson: referenceRow.argsJson,
                        capabilityId: referenceRow.capabilityId,
                        toolCallId,
                      },
                    ]),
                }),
              }),
            }),
            insert: () => ({
              values: (rows: unknown) => {
                insertedValues.push(rows)
                return Promise.resolve()
              },
            }),
          }
          return fn(tx)
        },
      ),
    }

    const result = await resolveConnectorWritePermissionRequests({
      approved: false,
      actorUserId: 'user-1',
      db: db as never,
      toolCallId,
      workspaceId: 'workspace-1',
    })

    expect(result.isOk()).toBe(true)
    expect(insertedValues).toHaveLength(1)
    expect(insertedValues[0]).toEqual([
      expect.objectContaining({
        resultStatus: 'denied',
        error: 'User denied approval',
      }),
    ])
  })
})
