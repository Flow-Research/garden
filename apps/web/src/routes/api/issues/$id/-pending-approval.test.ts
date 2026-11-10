// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppRequestContext } from '@/lib/server/context'
import { getIssuePendingApproval } from './pending-approval'

const mockRequireAppRequestContext = vi.hoisted(() => vi.fn())
const mockRequireIssueAccess = vi.hoisted(() => vi.fn())

vi.mock('@/lib/server/context', () => ({
  requireAppRequestContext: mockRequireAppRequestContext,
}))

vi.mock('@/lib/server/issue-access', () => ({
  requireIssueAccess: mockRequireIssueAccess,
}))

const issueId = '00000000-0000-4000-8000-000000000001'
const runId = '00000000-0000-4000-8000-000000000002'
const requestId = '00000000-0000-4000-8000-000000000003'

function fakeDb(requestRow: unknown) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(async () => [requestRow]),
          })),
        })),
      })),
    })),
  }
}

async function getApproval(requestRow: unknown) {
  const db = fakeDb(requestRow)
  mockRequireAppRequestContext.mockReturnValueOnce({})
  mockRequireIssueAccess.mockResolvedValueOnce({
    db,
    issue: { id: issueId, activeRunId: runId },
  })
  return getIssuePendingApproval({
    context: {} as AppRequestContext,
    params: { id: issueId },
  })
}

describe('getIssuePendingApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the connector write preview as the body', async () => {
    const response = await getApproval({
      id: requestId,
      context: 'github.add_issue_comment',
      kind: 'connector_write',
      argsJson: {
        owner: 'acme',
        repo: 'web',
        issue_number: 42,
        body: 'Deploy the release',
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      approval: {
        request_id: requestId,
        title: 'github.add_issue_comment',
        body: 'Deploy the release',
        targetLabel: 'github.com/acme/web#42',
      },
    })
  })

  it('falls back to the context text when the args carry no preview', async () => {
    const response = await getApproval({
      id: requestId,
      context: 'discord.send_message',
      kind: 'connector_write',
      argsJson: null,
    })

    await expect(response.json()).resolves.toMatchObject({
      approval: {
        request_id: requestId,
        body: 'discord.send_message',
      },
    })
  })

  it('returns the access denial unchanged', async () => {
    const denied = Response.json({ error: 'forbidden' }, { status: 403 })
    mockRequireAppRequestContext.mockReturnValueOnce({})
    mockRequireIssueAccess.mockResolvedValueOnce(denied)

    const response = await getIssuePendingApproval({
      context: {} as AppRequestContext,
      params: { id: issueId },
    })

    expect(response).toBe(denied)
  })
})
