import { describe, expect, it, vi } from 'vitest'
import { AgentPermissionsSchema } from '@garden/core/agents/permissions'
import {
  ensureBrainRunHistory,
  isBrainRunToolAllowed,
  serializeBrainRunHistory,
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
  it('keeps both grants when first exposures run concurrently', async () => {
    const facet = {}
    let marker: unknown
    let releaseRead!: () => void
    const firstRead = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let reads = 0
    const expose = (tool: string) =>
      serializeBrainRunHistory(facet, () =>
        ensureBrainRunHistory({
          identity,
          permissions: allowed,
          exposeTool: tool,
          marker,
          readDurableHistory: async () => {
            reads++
            if (reads === 1) await firstRead
            return []
          },
          persist: (next) => {
            marker = next
          },
        }),
      )
    const first = expose('brain_search')
    const second = expose('add_to_brain')
    await Promise.resolve()
    expect(reads).toBe(1)
    releaseRead()
    expect((await first).isOk()).toBe(true)
    expect((await second).isOk()).toBe(true)
    expect(marker).toEqual({
      identity,
      tools: ['brain_search', 'add_to_brain'],
    })
    expect(reads).toBe(1)
  })

  it('validates an empty session without writing provenance', async () => {
    const persist = vi.fn()
    const result = await ensureBrainRunHistory({
      identity,
      permissions: allowed,
      marker: undefined,
      readOnly: true,
      readDurableHistory: async () => [],
      persist,
    })
    expect(result.isOk()).toBe(true)
    expect(persist).not.toHaveBeenCalled()
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
