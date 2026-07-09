import { describe, expect, it } from 'vitest'
import { buildIssueDeepLink, buildIssueDeepLinkPath } from './deep-link'

describe('issue deep links', () => {
  it('builds a workspace path that retains the selected issue', () => {
    expect(buildIssueDeepLinkPath('workspace-1', 'issue-2')).toBe(
      '/workspace?workspace_id=workspace-1&issue=issue-2',
    )
  })

  it('builds an absolute link for external surfaces', () => {
    expect(
      buildIssueDeepLink(
        'https://garden.example/settings',
        'workspace-1',
        'issue-2',
      ),
    ).toBe(
      'https://garden.example/workspace?workspace_id=workspace-1&issue=issue-2',
    )
  })

  it('encodes identifiers before placing them in the query string', () => {
    expect(buildIssueDeepLinkPath('workspace & one', 'issue/two')).toBe(
      '/workspace?workspace_id=workspace+%26+one&issue=issue%2Ftwo',
    )
  })
})
