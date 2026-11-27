import { describe, expect, it } from 'vitest'
import { isPendingFirstTurn, NEW_SESSION_TITLE } from '@/lib/api'
import type { AgentChatSession } from '@/lib/api'
import { buildDispatchPreview } from './chat-panel-controller'

/**
 * Guards the invariant both halves of the 2026-09-18 warm-session fix turn on.
 *
 * `/chats` has no thread in the URL, so it picks one by asking which threads
 * still look unused — `isPendingFirstTurn`, i.e. placeholder title AND empty
 * preview. Those two fields used to be written only when the client saw a
 * reply finish, so a thread that was sent to but never finished on this client
 * kept a real conversation in its runtime while its row still read as
 * pristine, and the next visit to `/chats` served that conversation under the
 * heading "New Chat".
 *
 * The controller now seeds the preview at dispatch. These tests pin the two
 * halves of that: the seed is never empty for a send that carries anything,
 * and a seeded row is no longer a candidate.
 */
function session(overrides: Partial<AgentChatSession> = {}): AgentChatSession {
  return {
    id: 'thread-1',
    runtime_key: 'thread-1',
    runtime_kind: 'chat',
    primary_issue_id: null,
    primaryIssue: null,
    title: NEW_SESSION_TITLE,
    lastMessage: '',
    status: 'idle',
    unread: false,
    archivedAt: null,
    agentId: 'agent-1',
    ...overrides,
  } as AgentChatSession
}

describe('buildDispatchPreview', () => {
  it('prefers the prose that was sent', () => {
    expect(buildDispatchPreview('  ship it  ', 0)).toBe('ship it')
  })

  /**
   * A send can be attachments with no prose. It still has to produce a
   * non-empty preview, because an empty preview is half of what marks a
   * thread as never-used — an attachment-only first turn would otherwise
   * leave the thread claimable as the next "New Chat".
   */
  it('names the attachments when there is no prose', () => {
    expect(buildDispatchPreview('', 1)).toBe('1 attachment')
    expect(buildDispatchPreview('   ', 3)).toBe('3 attachments')
  })

  it('is empty only when there was nothing to send', () => {
    expect(buildDispatchPreview('', 0)).toBe('')
  })
})

describe('warm-session eligibility after a dispatch write', () => {
  it('treats an untouched placeholder thread as claimable', () => {
    expect(isPendingFirstTurn(session())).toBe(true)
  })

  it('stops treating it as claimable once the dispatch preview lands', () => {
    const sent = session({
      title: 'ship it',
      lastMessage: buildDispatchPreview('ship it', 0),
    })
    expect(isPendingFirstTurn(sent)).toBe(false)
  })

  it('stops treating it as claimable for an attachment-only first turn', () => {
    // The title stays the placeholder here — `makeSessionTitle` has no prose
    // to work from — so the preview is the only thing ruling the thread out.
    const sent = session({ lastMessage: buildDispatchPreview('', 2) })
    expect(isPendingFirstTurn(sent)).toBe(false)
  })
})
