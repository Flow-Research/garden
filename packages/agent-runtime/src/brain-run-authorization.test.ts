import { describe, expect, it, vi } from 'vitest'
import { ensureIssueBrainAudience } from './issue-brain-audience'

const fixture = () => ({
  workspaceId: 'workspace-1',
  initializeEmpty: true,
  config: null as { brainAudience?: unknown } | null,
  readDurableHistory: vi
    .fn<() => Promise<readonly unknown[]>>()
    .mockResolvedValue([]),
  persistAudience: vi.fn<(audience: string) => void>(),
})

describe('issue Think history audience provenance', () => {
  it('stamps only verified empty durable history before the first shared turn', async () => {
    const input = fixture()
    expect((await ensureIssueBrainAudience(input)).isOk()).toBe(true)
    expect(input.readDurableHistory).toHaveBeenCalledOnce()
    expect(input.persistAudience).toHaveBeenCalledExactlyOnceWith(
      'org-v1:workspace-1',
    )
  })

  it('allows a previously verified audience without rewriting provenance', async () => {
    const input = {
      ...fixture(),
      initializeEmpty: false,
      config: { brainAudience: 'org-v1:workspace-1' },
    }
    expect((await ensureIssueBrainAudience(input)).isOk()).toBe(true)
    expect(input.readDurableHistory).not.toHaveBeenCalled()
    expect(input.persistAudience).not.toHaveBeenCalled()
  })

  it.each([
    { brainAudience: 'org-v1:workspace-2' },
    { brainAudience: 'owner-private:workspace-1' },
    { brainAudience: 1 },
    {},
  ])(
    'rejects mismatched or malformed persisted provenance %j',
    async (config) => {
      const input = { ...fixture(), config }
      const result = await ensureIssueBrainAudience(input)
      expect(result.isErr()).toBe(true)
      expect(result.isErr() && result.error.code).toBe('invalid_state')
      expect(input.persistAudience).not.toHaveBeenCalled()
    },
  )

  it('rejects retained durable messages even if the caller has an empty hydration cache', async () => {
    const input = fixture()
    // Deliberately keep no cache input: only the authoritative durable read
    // can establish emptiness after SDK best-effort hydration has failed.
    input.readDurableHistory.mockResolvedValue([
      { role: 'assistant', content: 'legacy private material' },
    ])
    const result = await ensureIssueBrainAudience(input)
    expect(result.isErr() && result.error.message).toContain(
      'unverified Brain audience',
    )
    expect(input.persistAudience).not.toHaveBeenCalled()
  })

  it('fails closed when durable history cannot be read', async () => {
    const input = fixture()
    const cause = new Error('Injected durable storage read failure')
    input.readDurableHistory.mockRejectedValue(cause)
    const result = await ensureIssueBrainAudience(input)
    expect(result.isErr() && result.error.code).toBe('runtime_failed')
    expect(result.isErr() && result.error.cause).toBe(cause)
    expect(input.persistAudience).not.toHaveBeenCalled()
  })

  it('does not initialize provenance during beforeTurn recovery', async () => {
    const input = { ...fixture(), initializeEmpty: false }
    expect((await ensureIssueBrainAudience(input)).isErr()).toBe(true)
    expect(input.persistAudience).not.toHaveBeenCalled()
  })

  it('fails closed when persisting the audience fails', async () => {
    const input = fixture()
    const cause = new Error('Injected durable storage write failure')
    input.persistAudience.mockImplementation(() => {
      throw cause
    })
    const result = await ensureIssueBrainAudience(input)
    expect(result.isErr() && result.error.code).toBe('runtime_failed')
    expect(result.isErr() && result.error.cause).toBe(cause)
  })
})
