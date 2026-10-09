import { describe, expect, it, vi } from 'vitest'
import { AgentPermissionsSchema } from '@garden/core/agents/permissions'
import {
  ensureBrainRunHistory,
  isBrainRunToolAllowed,
} from './brain-run-authority'

describe('Brain run grant semantics', () => {
  it.each([
    [{ full_access: true, allowed_tools: ['post_comment'] }, true],
    [{ full_access: false, allowed_tools: [] }, true],
    [{}, true],
    [{ full_access: false, allowed_tools: ['post_comment'] }, false],
    [{ full_access: false, allowed_tools: ['brain_search'] }, true],
  ])('preserves the existing policy %j', (policy, allowed) => {
    expect(
      isBrainRunToolAllowed(
        AgentPermissionsSchema.parse(policy),
        'brain_search',
      ),
    ).toBe(allowed)
  })
  it('read access does not imply write access', () => {
    const policy = AgentPermissionsSchema.parse({
      full_access: false,
      allowed_tools: ['brain_search'],
    })
    expect(isBrainRunToolAllowed(policy, 'add_to_brain')).toBe(false)
  })
})

describe('durable Brain history provenance', () => {
  const identity = 'issue:workspace:agent:owner'
  const allowed = AgentPermissionsSchema.parse({})
  const denied = AgentPermissionsSchema.parse({
    full_access: false,
    allowed_tools: ['post_comment'],
  })
  it('records possible exposure before a permitted turn and blocks revoked history', async () => {
    let marker: unknown
    const persist = (next: unknown) => {
      marker = next
    }
    const readDurableHistory = vi
      .fn(async (): Promise<unknown[]> => [])
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ role: 'assistant', content: 'sensitive' }])
    expect(
      (
        await ensureBrainRunHistory({
          identity,
          permissions: allowed,
          exposeTool: 'brain_search',
          marker,
          persist,
          readDurableHistory,
        })
      ).isOk(),
    ).toBe(true)
    expect(marker).toEqual({ identity, tools: ['brain_search'] })
    expect(
      (
        await ensureBrainRunHistory({
          identity,
          permissions: denied,
          marker,
          persist,
          readDurableHistory,
        })
      ).isErr(),
    ).toBe(true)
  })
  it('allows an always-denied new session and retained Brain-free resume', async () => {
    let marker: unknown
    const persist = (next: unknown) => {
      marker = next
    }
    expect(
      (
        await ensureBrainRunHistory({
          identity,
          permissions: denied,
          marker,
          persist,
          readDurableHistory: async () => [],
        })
      ).isOk(),
    ).toBe(true)
    const readDurableHistory = vi.fn(async () => [
      { role: 'assistant', content: 'ordinary work' },
    ])
    expect(
      (
        await ensureBrainRunHistory({
          identity,
          permissions: denied,
          marker,
          persist,
          readDurableHistory,
        })
      ).isOk(),
    ).toBe(true)
    expect(readDurableHistory).not.toHaveBeenCalled()
    expect(marker).toEqual({ identity, tools: [] })
  })
  it.each([
    undefined,
    null,
    {},
    { identity: 'other', tools: [] },
    { identity, tools: 'invalid' },
  ])('rejects unproven nonempty history %j', async (marker) => {
    const persist = vi.fn()
    expect(
      (
        await ensureBrainRunHistory({
          identity,
          permissions: allowed,
          marker,
          persist,
          readDurableHistory: async () => ['retained'],
        })
      ).isErr(),
    ).toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })
  it('fails closed when history or provenance storage fails', async () => {
    const history = await ensureBrainRunHistory({
      identity,
      permissions: denied,
      marker: undefined,
      persist: vi.fn(),
      readDurableHistory: async () => {
        throw new Error('storage')
      },
    })
    expect(history.isErr()).toBe(true)
    const write = await ensureBrainRunHistory({
      identity,
      permissions: allowed,
      exposeTool: 'brain_search',
      marker: undefined,
      persist: () => {
        throw new Error('storage')
      },
      readDurableHistory: async () => [],
    })
    expect(write.isErr()).toBe(true)
  })
})
