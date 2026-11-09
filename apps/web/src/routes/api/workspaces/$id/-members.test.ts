import type { AppRequestContext } from '@/lib/server/context'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from './members'
import { invokeRouteHandler } from '@/test/route-handler'

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireWorkspacePermission: vi.fn(),
  sendOrganizationInvitationEmail: vi.fn(),
}))

vi.mock('@/lib/server/control-plane', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/control-plane')>()
  return { ...actual, requireSession: mocks.requireSession }
})

vi.mock('@/lib/server/workspace-permissions', () => ({
  requireWorkspacePermission: mocks.requireWorkspacePermission,
  workspacePermissions: {
    invitationManage: { invitation: ['create', 'cancel'] },
  },
}))

vi.mock('@/lib/server/email/invitation', () => ({
  sendOrganizationInvitationEmail: mocks.sendOrganizationInvitationEmail,
}))

const workspaceId = '00000000-0000-4000-8000-000000000001'
const invitationId = '00000000-0000-4000-8000-000000000002'
const originalExpiry = new Date('2026-09-01T00:00:00.000Z')

const invitation = {
  id: invitationId,
  organizationId: workspaceId,
  inviterId: '00000000-0000-4000-8000-000000000003',
  email: 'invitee@example.com',
  role: 'member',
  status: 'pending',
  expiresAt: originalExpiry,
}

function resendRequest() {
  return new Request(
    `https://garden.test/api/workspaces/${workspaceId}/members`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: invitation.email, resend: true }),
    },
  )
}

function createDb(options: {
  updatedRows?: Array<{ id: string }>
  emailOrganization?: { name: string }
}) {
  const limit = vi
    .fn()
    .mockResolvedValueOnce([invitation])
    .mockResolvedValueOnce([options.emailOrganization ?? { name: 'Acme' }])
  const updatePayloads: Array<Record<string, unknown>> = []
  const updatePredicates: unknown[] = []

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => {
        updatePayloads.push(payload)
        const updateIndex = updatePayloads.length
        return {
          where: vi.fn((predicate: unknown) => {
            updatePredicates.push(predicate)
            return updateIndex === 1
              ? {
                  returning: vi
                    .fn()
                    .mockResolvedValue(
                      options.updatedRows ?? [{ id: invitationId }],
                    ),
                }
              : Promise.resolve()
          }),
        }
      }),
    })),
  }

  return { db, updatePayloads, updatePredicates }
}

async function postResend(db: ReturnType<typeof createDb>['db']) {
  const request = resendRequest()
  const response = await invokeRouteHandler(Route, 'POST', {
    context: {
      db: async () => db,
      env: {},
      auth: { getAuth: async () => ({ api: {} }) },
    } as unknown as AppRequestContext,
    request,
    params: { id: workspaceId },
  })
  return { request, response }
}

describe('workspace invitation resend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireSession.mockResolvedValue({
      user: { email: 'admin@example.com', name: 'Admin' },
    })
    mocks.requireWorkspacePermission.mockResolvedValue(null)
    mocks.sendOrganizationInvitationEmail.mockResolvedValue(undefined)
  })

  it('rejects a member without invite permission before reading the invite', async () => {
    const { db } = createDb({})
    mocks.requireWorkspacePermission.mockResolvedValueOnce(
      Response.json({ error: 'Forbidden' }, { status: 403 }),
    )

    const { request, response } = await postResend(db)

    expect(response?.status).toBe(403)
    expect(mocks.requireWorkspacePermission).toHaveBeenCalledWith({
      appContext: expect.anything(),
      request,
      workspaceId,
      permissions: { invitation: ['create', 'cancel'] },
    })
    expect(db.select).not.toHaveBeenCalled()
    expect(mocks.sendOrganizationInvitationEmail).not.toHaveBeenCalled()
  })

  it('refreshes the same pending invite and sends one email', async () => {
    const { db, updatePayloads } = createDb({})

    const { response } = await postResend(db)

    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toMatchObject({ id: invitationId })
    expect(updatePayloads).toHaveLength(1)
    expect(updatePayloads[0]?.expiresAt).toBeInstanceOf(Date)
    expect(mocks.sendOrganizationInvitationEmail).toHaveBeenCalledOnce()
  })

  it('does not email when the pending update loses a cancellation race', async () => {
    const { db } = createDb({ updatedRows: [] })

    const { response } = await postResend(db)

    expect(response?.status).toBe(404)
    expect(mocks.sendOrganizationInvitationEmail).not.toHaveBeenCalled()
  })

  it('restores the old expiry when email delivery fails', async () => {
    const { db, updatePayloads } = createDb({})
    mocks.sendOrganizationInvitationEmail.mockRejectedValueOnce(
      new Error('delivery failed'),
    )

    const { response } = await postResend(db)

    expect(response?.status).toBe(502)
    expect(updatePayloads).toHaveLength(2)
    expect(updatePayloads[1]).toEqual({ expiresAt: originalExpiry })
  })
})
