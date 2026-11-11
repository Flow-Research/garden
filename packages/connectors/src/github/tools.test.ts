import { Effect, Layer, Option, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import githubConnector from './connector.ts'
import { GitHubRestClient, type GitHubRequest } from './rest-client.ts'
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
        'issue_write',
      ]),
    )
  })

  it('accepts assignees on issue_write for create and update', () => {
    const issueWrite = githubNativeTools.find(
      (tool) => tool.name === 'issue_write',
    )
    expect(issueWrite).toBeDefined()
    if (!issueWrite) return

    expect(
      Option.isSome(
        Schema.decodeUnknownOption(issueWrite.input)({
          owner: 'acme',
          repo: 'garden',
          title: 'Assign me',
          assignees: ['octocat'],
        }),
      ),
    ).toBe(true)
    expect(
      Option.isSome(
        Schema.decodeUnknownOption(issueWrite.input)({
          owner: 'acme',
          repo: 'garden',
          issueNumber: 12,
          assignees: ['octocat'],
        }),
      ),
    ).toBe(true)
  })

  it('adds assignees on update instead of replacing the existing list', async () => {
    const issueWrite = githubNativeTools.find(
      (tool) => tool.name === 'issue_write',
    )
    if (!issueWrite) throw new Error('issue_write missing')
    const requests: GitHubRequest[] = []
    const fakeClient = Layer.succeed(GitHubRestClient, {
      request: (request) => {
        requests.push(request)
        return Effect.succeed({ ok: true })
      },
    })

    await Effect.runPromise(
      issueWrite
        .execute({
          owner: 'acme',
          repo: 'garden',
          issueNumber: 12,
          title: 'Renamed',
          assignees: ['octocat'],
        })
        .pipe(Effect.provide(fakeClient)),
    )

    expect(requests.map((r) => [r.method, r.path, r.body])).toEqual([
      [
        'PATCH',
        '/repos/acme/garden/issues/12',
        {
          title: 'Renamed',
          body: undefined,
          state: undefined,
          labels: undefined,
        },
      ],
      [
        'POST',
        '/repos/acme/garden/issues/12/assignees',
        { assignees: ['octocat'] },
      ],
    ])
  })

  // #332: the gate rejects a wrong owner, but the schema descriptions are
  // what keep the model from guessing the login in the first place. This
  // asserts they survive into the JSON schema the model actually receives.
  it('describes owner/repo with the connected account login requirement', () => {
    const tool = githubNativeTools.find(
      (entry) => entry.name === 'list_branches',
    )
    const properties = (
      tool?.inputSchema as
        | { properties?: Record<string, { description?: string }> }
        | undefined
    )?.properties
    expect(properties?.owner?.description).toContain(
      'connected GitHub account login',
    )
    expect(properties?.repo?.description).toContain(
      'exactly as GitHub stores it',
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
