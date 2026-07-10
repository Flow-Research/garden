import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { Issue } from '@garden/core/types'
import { issueKeys } from './queries'
import {
  invalidateFilteredIssueCaches,
  removeFromFilteredIssueCaches,
  syncFilteredIssueCaches,
} from './mutations'

const workspaceId = 'workspace-1'
const issue = {
  id: 'issue-1',
  identifier: 'ISS-1',
  title: 'Original',
  description: null,
  status: 'done',
  priority: 'medium',
} as Issue

describe('filtered issue mutation caches', () => {
  it('removes done issues that move open and updates active search rows', () => {
    const client = new QueryClient()
    client.setQueryData(issueKeys.allDone(workspaceId), [issue])
    client.setQueryData(issueKeys.search(workspaceId, 'original'), [issue])

    const updated = { ...issue, title: 'Updated', status: 'todo' as const }
    syncFilteredIssueCaches(client, workspaceId, updated)

    expect(client.getQueryData(issueKeys.allDone(workspaceId))).toEqual([])
    expect(
      client.getQueryData(issueKeys.search(workspaceId, 'original')),
    ).toEqual([updated])
  })

  it('removes deleted issues and invalidates authoritative collections', () => {
    const client = new QueryClient()
    client.setQueryData(issueKeys.allDone(workspaceId), [issue])
    client.setQueryData(issueKeys.search(workspaceId, 'original'), [issue])

    removeFromFilteredIssueCaches(client, workspaceId, new Set([issue.id]))
    invalidateFilteredIssueCaches(client, workspaceId)

    expect(client.getQueryData(issueKeys.allDone(workspaceId))).toEqual([])
    expect(
      client.getQueryData(issueKeys.search(workspaceId, 'original')),
    ).toEqual([])
    expect(
      client.getQueryState(issueKeys.allDone(workspaceId))?.isInvalidated,
    ).toBe(true)
    expect(
      client.getQueryState(issueKeys.search(workspaceId, 'original'))
        ?.isInvalidated,
    ).toBe(true)
  })
})
