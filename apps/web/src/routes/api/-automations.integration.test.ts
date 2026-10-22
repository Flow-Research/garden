// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { Result } from 'better-result'
import * as schema from '@garden/db/schema'
import { startTestDb, type TestDb } from '@garden/db/testing'
import type { AppRequestContext } from '@/lib/server/context'
import { invokeRouteHandler } from '@/test/route-handler'
import { Route as AutomationsRoute } from './automations'
import { Route as TriggerRoute } from './automations/$id/triggers/$triggerId'

const state = vi.hoisted(() => ({
  db: null as unknown,
  workspaceId: '',
  userId: '',
  install: vi.fn(),
}))

vi.mock('@/lib/server/context', () => ({
  requireAppRequestContext: () => ({ db: async () => state.db }),
}))
vi.mock('@/lib/server/db', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  getDb: async () => state.db,
}))
vi.mock('@/lib/server/env', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  appEnv: {
    AUTOMATION_TRIGGER: {
      idFromName: (name: string) => name,
      get: () => ({ install: state.install, uninstall: vi.fn() }),
    },
  },
}))
vi.mock('@/lib/server/control-plane', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  requireWorkspaceContext: async () => ({
    workspaceId: state.workspaceId,
    session: { user: { id: state.userId } },
  }),
}))
vi.mock('@/lib/server/workspace-permissions', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  requireWorkspacePermission: async () => null,
  requireWorkspaceMember: async () => ({
    session: { user: { id: state.userId } },
  }),
}))
vi.mock('@/lib/posthog-server', () => ({ capturePostHogEvent: vi.fn() }))

let testDb: TestDb
let agentId: string

function installSucceeds() {
  state.install.mockResolvedValue(Result.serialize(Result.ok()))
}

function installFails() {
  state.install.mockRejectedValue(new Error('Durable Object unavailable'))
}

function post(path: string, method: 'POST' | 'PATCH', body: unknown) {
  return {
    context: {} as AppRequestContext,
    request: new Request(`https://garden.test${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  }
}

async function createAutomation(title: string) {
  return await invokeRouteHandler(
    AutomationsRoute,
    'POST',
    post('/api/automations', 'POST', {
      title,
      assignee_agent_id: agentId,
      trigger: { cron_expression: '0 9 * * *', timezone: 'UTC' },
    }),
  )
}

describe('automation schedule installation (integration)', () => {
  beforeAll(async () => {
    testDb = await startTestDb()
    state.db = testDb.db
    state.userId = randomUUID()
    state.workspaceId = randomUUID()
    agentId = randomUUID()
    await testDb.db.insert(schema.user).values({
      id: state.userId,
      email: `${state.userId}@garden.test`,
      name: 'Owner',
    })
    await testDb.db.insert(schema.organization).values({
      id: state.workspaceId,
      name: 'Workspace',
      slug: `ws-${state.workspaceId}`,
    })
    await testDb.db.insert(schema.agent).values({
      id: agentId,
      workspaceId: state.workspaceId,
      ownerUserId: state.userId,
      name: 'Scheduler',
    })
  }, 120_000)

  afterAll(async () => {
    await testDb?.cleanup()
  })

  beforeEach(() => {
    state.install.mockReset()
  })

  it('stores nothing when the schedule cannot be installed', async () => {
    installFails()

    const response = await createAutomation('Never scheduled')

    expect(response.status).toBeGreaterThanOrEqual(400)
    const automations = await testDb.db
      .select({ id: schema.automation.id })
      .from(schema.automation)
      .where(eq(schema.automation.title, 'Never scheduled'))
    expect(automations).toEqual([])
    expect(await testDb.db.select().from(schema.automationTrigger)).toEqual([])
  })

  it('stores the automation and trigger once the schedule is installed', async () => {
    installSucceeds()

    const response = await createAutomation('Daily report')

    expect(response.status).toBe(201)
    const [automation] = await testDb.db
      .select({ id: schema.automation.id })
      .from(schema.automation)
      .where(eq(schema.automation.title, 'Daily report'))
    expect(automation).toBeDefined()
    expect(state.install).toHaveBeenCalledTimes(1)
  })

  it('keeps the previous trigger settings when reinstalling fails', async () => {
    installSucceeds()
    const { value: created } = (await (
      await createAutomation('Weekly digest')
    ).json()) as {
      value: { automation: { id: string }; trigger: { id: string } }
    }
    installFails()

    const response = await invokeRouteHandler(TriggerRoute, 'PATCH', {
      ...post(
        `/api/automations/${created.automation.id}/triggers/${created.trigger.id}`,
        'PATCH',
        { cron_expression: '0 17 * * 5' },
      ),
      params: { id: created.automation.id, triggerId: created.trigger.id },
    })

    expect(response.status).toBeGreaterThanOrEqual(400)
    const [trigger] = await testDb.db
      .select({ cronExpression: schema.automationTrigger.cronExpression })
      .from(schema.automationTrigger)
      .where(eq(schema.automationTrigger.id, created.trigger.id))
    expect(trigger?.cronExpression).toBe('0 9 * * *')
  })
})
