import { describe, expect, it } from 'vitest'
import { isAgentDoPath } from './agent-do-path'

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
