import { issueKeys } from '@/lib/issues/queries'

/** Query-key roots invalidated for a realtime event; null when ignored. */
export function realtimeInvalidationRoots(
  event: { type?: unknown; workspace_id?: unknown; payload?: unknown },
  workspaceId: string,
): (readonly unknown[])[] | null {
  if (event.workspace_id !== workspaceId || typeof event.type !== 'string') {
    return null
  }

  switch (event.type) {
    case 'team:created':
    case 'team:updated':
    case 'team:deleted':
    case 'team_member:added':
    case 'team_member:removed':
    case 'team_member:updated':
      return [['teams', workspaceId]]
    case 'issue:created':
    case 'issue:updated':
    case 'issue:deleted': {
      const issueId = eventIssueId(event.payload)
      return [
        ['issues', workspaceId],
        ...(issueId ? issueResourceRoots(issueId) : []),
      ]
    }
    case 'comment:created':
    case 'comment:updated':
    case 'comment:deleted': {
      const issueId = eventIssueId(event.payload)
      return issueId ? [issueKeys.timeline(issueId)] : null
    }
    default:
      return null
  }
}

/**
 * An issue's own resources are keyed by issue id alone, outside the
 * `['issues', wsId]` root, so invalidating that root never reached them and
 * an open issue missed other people's changes.
 */
function issueResourceRoots(issueId: string): (readonly unknown[])[] {
  return [
    issueKeys.timeline(issueId),
    issueKeys.subscribers(issueId),
    issueKeys.pendingApproval(issueId),
  ]
}

function eventIssueId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  if ('issue_id' in payload && typeof payload.issue_id === 'string') {
    return payload.issue_id
  }
  if (
    'issue' in payload &&
    payload.issue &&
    typeof payload.issue === 'object' &&
    'id' in payload.issue &&
    typeof payload.issue.id === 'string'
  ) {
    return payload.issue.id
  }
  return null
}
