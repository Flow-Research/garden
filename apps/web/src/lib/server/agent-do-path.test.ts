import { describe, expect, it, vi } from 'vitest'
import { getChatFacetTarget, isAgentDoPath } from './agent-do-path'

vi.mock('agents', async () => ({
  parseSubAgentPath: (
    await import(
      new URL('./sub-routing.js', import.meta.resolve('agents')).href
    )
  ).parseSubAgentPath,
}))

describe('isAgentDoPath', () => {
  it('matches agent Durable Object traffic', () => {
    expect(isAgentDoPath('/agents/agent-d-o/abc')).toBe(true)
  })

  it('leaves the agent detail page to the app router', () => {
    expect(isAgentDoPath('/agents/d2814cc1-34f8-474f-a492-bb73d7c6ee87')).toBe(
      false,
    )
    expect(isAgentDoPath('/agents')).toBe(false)
  })
})

describe('getChatFacetTarget', () => {
  const base = 'https://garden.test/agents/agent-d-o/shared-parent'
  it('uses the SDK-decoded chat child name', () => {
    expect(
      getChatFacetTarget(`${base}/sub/chat-sub-agent/%30owner/get-messages`),
    ).toEqual({ kind: 'chat', threadName: '0owner' })
  })
  it.each([
    '/sub/chat-sub-agent/%ZZ/get-messages',
    '/sub/unknown/wrapper/sub/chat-sub-agent/owner/get-messages',
    '/sub/issue-run-sub-agent/run/sub/chat-sub-agent/owner/get-messages',
    '/sub/chat-sub-agent/owner/sub/unknown/nested',
    '/sub/chat-sub-agent/%ZZ/sub/chat-sub-agent/owner/get-messages',
  ])('refuses unsupported or malformed chat routing %s', (path) => {
    expect(getChatFacetTarget(`${base}${path}`)).toEqual({ kind: 'invalid' })
  })
  it.each([
    '',
    '/sub/chat-sub-agent-extra/thread',
    '/sub/issue-run-sub-agent/run',
    '/sub/automation-run-sub-agent/run',
  ])('does not restrict a nonchat route %s', (path) => {
    expect(getChatFacetTarget(`${base}${path}`)).toEqual({ kind: 'none' })
  })
})
