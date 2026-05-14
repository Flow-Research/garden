import { describe, expect, it } from 'vitest'
import { buildReadSourceToolArgs } from './agent-tools/read-source'

describe('buildReadSourceToolArgs', () => {
  it('populates GitHub issue_read method when the upstream schema requires it', () => {
    const args = buildReadSourceToolArgs(
      {
        connectorId: 'github',
        sourceKind: 'issue',
        externalId:
          'https://github.com/Flow-Research/garden/issues/24?garden_e2e=test',
        externalUrl: null,
      } as never,
      {
        name: 'issue_read',
        serverId: 'github',
        inputSchema: {
          type: 'object',
          properties: {
            method: { type: 'string' },
            owner: { type: 'string' },
            repo: { type: 'string' },
            issue_number: { type: 'number' },
          },
          required: ['method', 'owner', 'repo', 'issue_number'],
        },
      },
    )

    expect(args).toEqual({
      method: 'get',
      owner: 'Flow-Research',
      repo: 'garden',
      issue_number: 24,
    })
  })
})
