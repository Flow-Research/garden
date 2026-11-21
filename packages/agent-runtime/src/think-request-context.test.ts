import { describe, expect, it } from 'vitest'
import { ContinuationState, createChatFiberSnapshot } from 'agents/chat'
import type { ChatRequestContext, ChatRequestSource } from '@cloudflare/think'

type ContextModule = {
  mergeRequestContexts: (
    left: ChatRequestContext,
    right: ChatRequestContext,
  ) => ChatRequestContext
  currentRequestContext: () => ChatRequestContext | undefined
  runWithRequestContext: <T>(
    context: ChatRequestContext,
    callback: () => T,
  ) => T
  captureRequestContext: (
    connection: { id: string; tags: readonly string[] } | undefined,
    applicationContext?: Record<string, unknown>,
    parent?: ChatRequestContext,
  ) => ChatRequestContext
  newRequestContext: (
    source: ChatRequestSource,
    parent?: ChatRequestContext,
  ) => ChatRequestContext
  readRequestContext: (value: unknown) => ChatRequestContext
  bindResultContext: <T extends object>(
    result: T,
    context: ChatRequestContext,
  ) => T
  resultRequestContext: (result: object) => ChatRequestContext
  isIssuedRequestContext: (value: unknown) => boolean
}

// The maintained package helper is internal. Import its actual installed bytes
// without importing the Worker platform or copying its implementation into tests.
const contexts: ContextModule = await import(
  new URL('request-context.js', import.meta.resolve('@cloudflare/think')).href
)

const connection = { id: 'server-connection', tags: ['server-owned-scope'] }

describe('maintained Think request context', () => {
  it('captures immutable server tags and ignores forged programmatic source hints', () => {
    const tags = ['original-scope']
    const request = contexts.captureRequestContext(
      { id: 'server-id', tags },
      { kind: 'submission', submissionId: 'forged' },
    )
    tags[0] = 'changed-scope'
    expect(request.source).toEqual({
      kind: 'connection',
      connectionId: 'server-id',
      connectionTags: ['original-scope'],
      applicationContext: { kind: 'submission', submissionId: 'forged' },
    })
    expect(Object.isFrozen(request)).toBe(true)
    expect(Object.isFrozen(request.source)).toBe(true)
    if (request.source.kind !== 'connection')
      throw new Error('Expected the actual connection source')
    expect(Object.isFrozen(request.source.connectionTags)).toBe(true)
  })

  it('keeps absent connections unattributed without an explicit server context', () => {
    expect(contexts.captureRequestContext(undefined).source).toEqual({
      kind: 'unattributed',
    })
    expect(contexts.readRequestContext(undefined).source).toEqual({
      kind: 'unattributed',
    })
    expect(contexts.readRequestContext(null).source).toEqual({
      kind: 'unattributed',
    })
  })

  it('copies exact server submission identity and metadata before mutation', () => {
    const metadata = { gardenChat: { runId: 'first', attempt: 2 } }
    const request = contexts.newRequestContext({
      kind: 'submission',
      submissionId: 'exact-submission',
      metadata,
    })
    metadata.gardenChat.runId = 'later'
    expect(request.source).toEqual({
      kind: 'submission',
      submissionId: 'exact-submission',
      metadata: { gardenChat: { runId: 'first', attempt: 2 } },
    })
  })

  it('restores durable context without borrowing a warm connection', () => {
    const original = contexts.captureRequestContext(connection)
    const recovered = contexts.readRequestContext(
      JSON.parse(JSON.stringify(original)),
    )
    expect(recovered).toEqual(original)
    expect(recovered).not.toBe(original)
    expect(contexts.isIssuedRequestContext(recovered)).toBe(true)
    expect(contexts.isIssuedRequestContext({ ...original })).toBe(false)
    expect(() =>
      contexts.readRequestContext({ ...original, source: { kind: 'server' } }),
    ).toThrow('Chat request source is invalid.')
  })

  it('starts each new user request at a fresh root', () => {
    const first = contexts.captureRequestContext(connection)
    const fresh = contexts.captureRequestContext(connection)
    expect(fresh.requestId).not.toBe(first.requestId)
    expect(fresh.rootRequestId).toBe(fresh.requestId)
    expect(fresh.parentRequestId).toBeUndefined()
    expect(fresh.initiatingSources).toBeUndefined()
  })

  it('retains only exact continuation lineage and deduplicates the same source', () => {
    const first = contexts.captureRequestContext(connection)
    const second = contexts.captureRequestContext(
      { id: 'new-actor', tags: ['new-scope'] },
      undefined,
      first,
    )
    expect(second.rootRequestId).toBe(first.rootRequestId)
    expect(second.parentRequestId).toBe(first.requestId)
    expect(second.initiatingSources).toEqual([first.source])
    const repeated = contexts.captureRequestContext(
      { id: 'new-actor', tags: ['new-scope'] },
      undefined,
      second,
    )
    expect(repeated.initiatingSources).toEqual([first.source])
  })

  it('refuses lineage overflow instead of dropping earlier actors', () => {
    let request = contexts.captureRequestContext({ id: '0', tags: [] })
    for (let index = 1; index < 16; index++)
      request = contexts.captureRequestContext(
        { id: String(index), tags: [] },
        undefined,
        request,
      )
    const before = JSON.stringify(request)
    expect(() =>
      contexts.captureRequestContext(
        { id: 'overflow', tags: [] },
        undefined,
        request,
      ),
    ).toThrow('Chat request lineage exceeds its bound.')
    expect(JSON.stringify(request)).toBe(before)
  })

  it('refuses large, recursive, executable and non-JSON application contexts', () => {
    expect(() =>
      contexts.captureRequestContext(undefined, { text: 'x'.repeat(4097) }),
    ).toThrow('Chat request context string exceeds its bound.')
    const recursive: Record<string, unknown> = {}
    recursive.self = recursive
    expect(() => contexts.captureRequestContext(undefined, recursive)).toThrow(
      'Chat request context exceeds its bound.',
    )
    expect(() =>
      contexts.captureRequestContext(undefined, { action: () => true }),
    ).toThrow('Chat request context must contain plain JSON values.')
    expect(() =>
      contexts.captureRequestContext(undefined, { number: Number.NaN }),
    ).toThrow('Chat request context must contain plain JSON values.')
  })

  it('keeps asynchronous context separate across concurrent turns and clears it outside the turn', async () => {
    const first = contexts.captureRequestContext(connection)
    const second = contexts.captureRequestContext({ id: 'other', tags: [] })
    let release: () => void = () => undefined
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const delayed = contexts.runWithRequestContext(first, async () => {
      await barrier
      expect(contexts.currentRequestContext()).toEqual(first)
    })
    await contexts.runWithRequestContext(second, async () => {
      await Promise.resolve()
      expect(contexts.currentRequestContext()).toEqual(second)
      release()
    })
    await delayed
    expect(contexts.currentRequestContext()).toBeUndefined()
  })

  it('retains opaque sources in the actual Agents deferred helper after connection loss', () => {
    const request = contexts.captureRequestContext(connection)
    const state = new ContinuationState()
    state.deferred = {
      connection: { id: connection.id, send: () => undefined },
      connectionId: connection.id,
      requestContext: request,
      errorPrefix: 'fixture',
      prerequisite: null,
    }
    state.releaseConnection(connection.id)
    const activated = state.activateDeferred(() => 'sdk-continuation')
    expect(activated?.connectionId).toBeNull()
    expect(activated?.requestContext).toBe(request)
    state.clearAll()
    expect(state.pending).toBeNull()
    expect(state.deferred).toBeNull()
  })

  it('retains opaque sources in the actual Agents recovery snapshot helper', () => {
    const request = contexts.captureRequestContext(connection)
    const snapshot = createChatFiberSnapshot({
      kind: 'fixture',
      requestId: 'sdk-request',
      continuation: false,
      messages: [{ id: 'user', role: 'user' }],
      requestContext: request,
    })
    expect(
      contexts.readRequestContext(
        JSON.parse(JSON.stringify(snapshot)).requestContext,
      ),
    ).toEqual(request)
  })

  it('merges exact sibling source branches without accumulating repeated callbacks or dropping an actor', () => {
    const root = contexts.captureRequestContext(connection)
    const first = contexts.captureRequestContext(
      { id: 'first-actor', tags: [] },
      undefined,
      root,
    )
    const second = contexts.captureRequestContext(
      { id: 'second-actor', tags: [] },
      undefined,
      root,
    )
    const common = { id: 'current-actor', tags: [] }
    const left = contexts.captureRequestContext(common, undefined, first)
    const right = contexts.captureRequestContext(common, undefined, second)
    let merged = contexts.mergeRequestContexts(left, right)
    expect(merged.initiatingSources).toEqual([
      root.source,
      first.source,
      second.source,
    ])
    for (let index = 0; index < 100; index++)
      merged = contexts.mergeRequestContexts(merged, right)
    expect(merged.initiatingSources).toHaveLength(3)
    expect(() =>
      contexts.mergeRequestContexts(
        left,
        contexts.captureRequestContext(common),
      ),
    ).toThrow('Chat continuation authority conflicts.')
  })

  it('refuses a combined sibling lineage above 16 sources without changing either branch', () => {
    const root = contexts.captureRequestContext(connection)
    const common = { id: 'current', tags: [] }
    const branch = (prefix: string, count: number) => {
      let current = root
      for (let index = 0; index < count; index++)
        current = contexts.captureRequestContext(
          { id: `${prefix}:${index}`, tags: [] },
          undefined,
          current,
        )
      return contexts.captureRequestContext(common, undefined, current)
    }
    const left = branch('left', 7)
    const right = branch('right', 8)
    const before = [JSON.stringify(left), JSON.stringify(right)]
    expect(() => contexts.mergeRequestContexts(left, right)).toThrow(
      'Chat request lineage exceeds its bound.',
    )
    expect([JSON.stringify(left), JSON.stringify(right)]).toEqual(before)
  })

  it('binds stream results by issued object identity without trusting a copied property', () => {
    const request = contexts.captureRequestContext(connection)
    const result = contexts.bindResultContext({}, request)
    expect(contexts.resultRequestContext(result)).toEqual(request)
    expect(
      contexts.resultRequestContext({ requestContext: request }).source,
    ).toEqual({ kind: 'unattributed' })
  })
})
