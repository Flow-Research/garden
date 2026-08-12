import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import {
  AgentId,
  ConversationId,
  MailboxId,
  WorkspaceId,
} from '@garden/core/mail'
import {
  MailAgentDispatchParams,
  dispatchAssignedMailAgent,
  type MailAgentWorkflowBinding,
} from './mail-agent-workflow-dispatch'

const params = MailAgentDispatchParams.make({
  workspaceId: WorkspaceId.make('fa200000-0000-4000-8000-000000000001'),
  ownerUserId: 'fa200000-0000-4000-8000-000000000002',
  agentId: AgentId.make('fa200000-0000-4000-8000-000000000003'),
  mailboxId: MailboxId.make('fa200000-0000-4000-8000-000000000004'),
  conversationId: ConversationId.make('fa200000-0000-4000-8000-000000000005'),
  eventId: 'fa200000-0000-4000-8000-000000000006',
  reason: 'assignment',
})

const workflowId = `mail-agent-${params.eventId}-${params.agentId}`

describe('mail agent Workflow dispatch', () => {
  it('creates one deterministic Workflow instance', async () => {
    const create = vi.fn(async () => ({ id: workflowId }))
    const get = vi.fn(async () => ({ id: workflowId }))
    const binding: MailAgentWorkflowBinding = { create, get }

    const result = await Effect.runPromise(
      dispatchAssignedMailAgent(binding, params),
    )

    expect(result).toEqual({ workflowId })
    expect(create).toHaveBeenCalledWith({ id: workflowId, params })
    expect(workflowId).toMatch(/^[a-zA-Z0-9_][a-zA-Z0-9-_]*$/)
    expect(workflowId.length).toBeLessThanOrEqual(100)
    expect(get).not.toHaveBeenCalled()
  })

  it('recovers the same Workflow instead of creating a second turn', async () => {
    const create = vi.fn(async () => {
      throw new Error('instance already exists')
    })
    const get = vi.fn(async () => ({ id: workflowId, status: 'running' }))
    const binding: MailAgentWorkflowBinding = { create, get }

    const result = await Effect.runPromise(
      dispatchAssignedMailAgent(binding, params),
    )

    expect(result).toEqual({ workflowId })
    expect(create).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith(workflowId)
  })

  it('gives each assigned agent an independent durable turn for one message', async () => {
    const create = vi.fn(async ({ id }: { id: string }) => ({ id }))
    const binding: MailAgentWorkflowBinding = {
      create,
      get: vi.fn(async () => undefined),
    }
    const secondAgentParams = MailAgentDispatchParams.make({
      ...params,
      agentId: AgentId.make('fa200000-0000-4000-8000-000000000007'),
    })

    const first = await Effect.runPromise(
      dispatchAssignedMailAgent(binding, params),
    )
    const second = await Effect.runPromise(
      dispatchAssignedMailAgent(binding, secondAgentParams),
    )

    expect(first.workflowId).not.toBe(second.workflowId)
    expect(create).toHaveBeenCalledTimes(2)
  })
})
