import { describe, expect, it } from 'vitest'
import {
  gardenMailExecutorToolkitSlug,
  isGardenMailExecutorToolkit,
} from './executor-scope.js'

describe('Garden Mail Executor toolkit scope', () => {
  it('constructs one accepted toolkit per member and agent authority', async () => {
    const authority = {
      workspaceId: 'workspace-1',
      userId: 'user-1',
      agentId: 'agent-1',
    }

    const first = await gardenMailExecutorToolkitSlug(authority)
    const repeated = await gardenMailExecutorToolkitSlug(authority)
    const anotherAgent = await gardenMailExecutorToolkitSlug({
      ...authority,
      agentId: 'agent-2',
    })

    expect(first).toBe(repeated)
    expect(isGardenMailExecutorToolkit(first)).toBe(true)
    expect(anotherAgent).not.toBe(first)
    expect(isGardenMailExecutorToolkit('garden-mail')).toBe(false)
  })
})
