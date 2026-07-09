/**
 * Builds the canonical in-app path for opening an issue inside the workspace
 * dock. Issue details are panels rather than standalone pages, so a bare
 * `/issues/:id` URL previously returned 404 and copying the current `/workspace`
 * pathname lost the selected issue. The workspace and issue query parameters
 * let auth select the correct organization before the dock opens the panel.
 */
export function buildIssueDeepLinkPath(
  workspaceId: string,
  issueId: string,
): string {
  const search = new URLSearchParams({
    workspace_id: workspaceId,
    issue: issueId,
  })
  return `/workspace?${search.toString()}`
}

/** Builds an absolute issue deep link for emails and other external surfaces. */
export function buildIssueDeepLink(
  baseURL: string,
  workspaceId: string,
  issueId: string,
): string {
  return new URL(buildIssueDeepLinkPath(workspaceId, issueId), baseURL).href
}
