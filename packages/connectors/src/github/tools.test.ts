import { describe, expect, it } from 'vitest'
import githubConnector from './connector.ts'
import { githubHostedMcpExtraClassifications } from './mcp-tools.ts'
import { githubNativeTools } from './tools.ts'

describe('GitHub App tool surface', () => {
  it('covers the repository, issue, pull request, release, search, and workflow operations', () => {
    const names = githubNativeTools.map((tool) => tool.name)

    expect(new Set(names).size).toBe(names.length)
    expect(names.length).toBeGreaterThanOrEqual(36)
    expect(names).toEqual(
      expect.arrayContaining([
        'search_repositories',
        'search_commits',
        'fork_repository',
        'get_latest_release',
        'add_reply_to_pull_request_comment',
        'update_pull_request',
        'update_pull_request_branch',
        'sub_issue_write',
      ]),
    )
  })

  it('classifies the live hosted-MCP-only operations', () => {
    expect(
      Object.keys(githubHostedMcpExtraClassifications).sort((first, second) =>
        first.localeCompare(second),
      ),
    ).toEqual([
      'actions_get',
      'actions_list',
      'actions_run_trigger',
      'add_comment_to_pending_review',
      'create_repository',
      'get_job_logs',
      'list_issue_fields',
      'list_issue_types',
      'push_files',
    ])
    expect(githubConnector.tools.actions_run_trigger?.riskClass).toBe(
      'send_external',
    )
    expect(githubConnector.tools.get_job_logs?.riskClass).toBe('read')
  })
})
