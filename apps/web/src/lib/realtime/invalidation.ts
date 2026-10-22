/** Query-key roots invalidated for a realtime event; null when ignored. */
export function realtimeInvalidationRoots(
  event: { type?: unknown; workspace_id?: unknown },
  workspaceId: string,
): string[][] | null {
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
    case 'issue:deleted':
      return [['issues', workspaceId]]
    default:
      return null
  }
}
