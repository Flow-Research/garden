import { Effect, Schema } from 'effect'
import { defineNativeConnectorTool } from '../effect/native.ts'
import { GitHubRestClient, type GitHubRequest } from './rest-client.ts'

const Pagination = {
  page: Schema.optional(Schema.Number),
  perPage: Schema.optional(Schema.Number),
}
const RepositoryListInput = Schema.Struct({
  ...Pagination,
})
const FileInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  path: Schema.String,
  ref: Schema.optional(Schema.String),
})
const SearchCodeInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  query: Schema.String,
  ...Pagination,
})
const IssueListInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  state: Schema.optional(Schema.Literals(['open', 'closed', 'all'])),
  labels: Schema.optional(Schema.String),
  ...Pagination,
})
const IssueInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  issueNumber: Schema.Number,
})
const IssueWriteInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  issueNumber: Schema.optional(Schema.Number),
  title: Schema.optional(Schema.String),
  body: Schema.optional(Schema.String),
  state: Schema.optional(Schema.Literals(['open', 'closed'])),
  labels: Schema.optional(Schema.Array(Schema.String)),
})
const IssueCommentInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  issueNumber: Schema.Number,
  body: Schema.String,
})
const PullRequestListInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  state: Schema.optional(Schema.Literals(['open', 'closed', 'all'])),
  base: Schema.optional(Schema.String),
  head: Schema.optional(Schema.String),
  ...Pagination,
})
const PullRequestInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  pullNumber: Schema.Number,
})
const CreatePullRequestInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  title: Schema.String,
  head: Schema.String,
  base: Schema.String,
  body: Schema.optional(Schema.String),
  draft: Schema.optional(Schema.Boolean),
})
const MergePullRequestInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  pullNumber: Schema.Number,
  commitTitle: Schema.optional(Schema.String),
  commitMessage: Schema.optional(Schema.String),
  mergeMethod: Schema.optional(Schema.Literals(['merge', 'squash', 'rebase'])),
})
const ReviewPullRequestInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  pullNumber: Schema.Number,
  body: Schema.String,
  event: Schema.Literals(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']),
})
const BranchListInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  ...Pagination,
})
const CreateBranchInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  branch: Schema.String,
  fromSha: Schema.String,
})
const CommitListInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  sha: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  ...Pagination,
})
const WorkflowRunsInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  workflowId: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  ...Pagination,
})
const DispatchWorkflowInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  workflowId: Schema.String,
  ref: Schema.String,
  inputs: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
const PutFileInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  path: Schema.String,
  message: Schema.String,
  content: Schema.String,
  branch: Schema.optional(Schema.String),
  sha: Schema.optional(Schema.String),
})
const DeleteFileInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  path: Schema.String,
  message: Schema.String,
  sha: Schema.String,
  branch: Schema.optional(Schema.String),
})
const RepositoryInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
})
const RepositoryRefInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  ref: Schema.String,
})
const RepositoryTagInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  tag: Schema.String,
})
const RepositorySearchInput = Schema.Struct({
  query: Schema.String,
  ...Pagination,
})
const ScopedSearchInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  query: Schema.String,
  ...Pagination,
})
const ForkRepositoryInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  organization: Schema.optional(Schema.String),
})
const PullRequestCommentReplyInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  commentId: Schema.Number,
  body: Schema.String,
})
const LabelInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  label: Schema.String,
})
const UpdatePullRequestInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  pullNumber: Schema.Number,
  title: Schema.optional(Schema.String),
  body: Schema.optional(Schema.String),
  state: Schema.optional(Schema.Literals(['open', 'closed'])),
  base: Schema.optional(Schema.String),
})
const UpdatePullRequestBranchInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  pullNumber: Schema.Number,
  expectedHeadSha: Schema.optional(Schema.String),
})
const SubIssueWriteInput = Schema.Struct({
  owner: Schema.String,
  repo: Schema.String,
  issueNumber: Schema.Number,
  subIssueId: Schema.Number,
  action: Schema.Literals(['add', 'remove']),
})

const repositoryPath = (owner: string, repo: string): string =>
  `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`

const requestGitHub = (request: GitHubRequest) =>
  Effect.gen(function* () {
    const client = yield* GitHubRestClient
    return yield* client.request(request)
  })

const base64Utf8 = (value: string): string => {
  let binary = ''
  for (const byte of new TextEncoder().encode(value)) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

export const githubNativeTools = [
  defineNativeConnectorTool({
    name: 'list_repositories',
    description:
      'List repositories available to the Garden GitHub App installation.',
    riskClass: 'read',
    requiredScopes: ['metadata:read'],
    input: RepositoryListInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.listRepositories',
        path: '/installation/repositories',
        query: { page: input.page, per_page: input.perPage },
      }),
  }),
  defineNativeConnectorTool({
    name: 'get_file_contents',
    description:
      'Read a file or directory from an installed GitHub repository.',
    riskClass: 'read',
    requiredScopes: ['contents:read'],
    input: FileInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.getFileContents',
        path: `${repositoryPath(input.owner, input.repo)}/contents/${input.path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
        query: { ref: input.ref },
      }),
  }),
  defineNativeConnectorTool({
    name: 'search_code',
    description: 'Search code inside one installed GitHub repository.',
    riskClass: 'read',
    requiredScopes: ['contents:read'],
    input: SearchCodeInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.searchCode',
        path: '/search/code',
        query: {
          q: `${input.query} repo:${input.owner}/${input.repo}`,
          page: input.page,
          per_page: input.perPage,
        },
      }),
  }),
  defineNativeConnectorTool({
    name: 'list_issues',
    description: 'List issues in an installed GitHub repository.',
    riskClass: 'read',
    requiredScopes: ['issues:read'],
    input: IssueListInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.listIssues',
        path: `${repositoryPath(input.owner, input.repo)}/issues`,
        query: {
          state: input.state,
          labels: input.labels,
          page: input.page,
          per_page: input.perPage,
        },
      }),
  }),
  defineNativeConnectorTool({
    name: 'issue_read',
    description: 'Read one GitHub issue or pull request conversation.',
    riskClass: 'read',
    requiredScopes: ['issues:read'],
    input: IssueInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.readIssue',
        path: `${repositoryPath(input.owner, input.repo)}/issues/${input.issueNumber}`,
      }),
  }),
  defineNativeConnectorTool({
    name: 'issue_write',
    description: 'Create or update a GitHub issue.',
    riskClass: 'send_external',
    requiredScopes: ['issues:write'],
    input: IssueWriteInput,
    handler: (input) => {
      let method: 'POST' | 'PATCH' = 'POST'
      let path = `${repositoryPath(input.owner, input.repo)}/issues`
      if (input.issueNumber !== undefined) {
        method = 'PATCH'
        path = `${path}/${input.issueNumber}`
      }
      return requestGitHub({
        operation: 'github.writeIssue',
        method,
        path,
        body: {
          title: input.title,
          body: input.body,
          state: input.state,
          labels: input.labels,
        },
      })
    },
  }),
  defineNativeConnectorTool({
    name: 'add_issue_comment',
    description: 'Add a comment to a GitHub issue or pull request.',
    riskClass: 'send_external',
    requiredScopes: ['issues:write'],
    input: IssueCommentInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.addIssueComment',
        method: 'POST',
        path: `${repositoryPath(input.owner, input.repo)}/issues/${input.issueNumber}/comments`,
        body: { body: input.body },
      }),
  }),
  defineNativeConnectorTool({
    name: 'list_pull_requests',
    description: 'List pull requests in an installed GitHub repository.',
    riskClass: 'read',
    requiredScopes: ['pull_requests:read'],
    input: PullRequestListInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.listPullRequests',
        path: `${repositoryPath(input.owner, input.repo)}/pulls`,
        query: {
          state: input.state,
          base: input.base,
          head: input.head,
          page: input.page,
          per_page: input.perPage,
        },
      }),
  }),
  defineNativeConnectorTool({
    name: 'pull_request_read',
    description: 'Read one GitHub pull request.',
    riskClass: 'read',
    requiredScopes: ['pull_requests:read'],
    input: PullRequestInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.readPullRequest',
        path: `${repositoryPath(input.owner, input.repo)}/pulls/${input.pullNumber}`,
      }),
  }),
  defineNativeConnectorTool({
    name: 'create_pull_request',
    description: 'Create a GitHub pull request.',
    riskClass: 'send_external',
    requiredScopes: ['pull_requests:write'],
    input: CreatePullRequestInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.createPullRequest',
        method: 'POST',
        path: `${repositoryPath(input.owner, input.repo)}/pulls`,
        body: input,
      }),
  }),
  defineNativeConnectorTool({
    name: 'merge_pull_request',
    description: 'Merge a GitHub pull request.',
    riskClass: 'destructive',
    requiredScopes: ['contents:write', 'pull_requests:write'],
    input: MergePullRequestInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.mergePullRequest',
        method: 'PUT',
        path: `${repositoryPath(input.owner, input.repo)}/pulls/${input.pullNumber}/merge`,
        body: {
          commit_title: input.commitTitle,
          commit_message: input.commitMessage,
          merge_method: input.mergeMethod,
        },
      }),
  }),
  defineNativeConnectorTool({
    name: 'pull_request_review_write',
    description: 'Submit a review on a GitHub pull request.',
    riskClass: 'send_external',
    requiredScopes: ['pull_requests:write'],
    input: ReviewPullRequestInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.reviewPullRequest',
        method: 'POST',
        path: `${repositoryPath(input.owner, input.repo)}/pulls/${input.pullNumber}/reviews`,
        body: { body: input.body, event: input.event },
      }),
  }),
  defineNativeConnectorTool({
    name: 'list_branches',
    description: 'List branches in an installed GitHub repository.',
    riskClass: 'read',
    requiredScopes: ['contents:read'],
    input: BranchListInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.listBranches',
        path: `${repositoryPath(input.owner, input.repo)}/branches`,
        query: { page: input.page, per_page: input.perPage },
      }),
  }),
  defineNativeConnectorTool({
    name: 'create_branch',
    description: 'Create a branch from a commit SHA.',
    riskClass: 'write',
    requiredScopes: ['contents:write'],
    input: CreateBranchInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.createBranch',
        method: 'POST',
        path: `${repositoryPath(input.owner, input.repo)}/git/refs`,
        body: { ref: `refs/heads/${input.branch}`, sha: input.fromSha },
      }),
  }),
  defineNativeConnectorTool({
    name: 'list_commits',
    description: 'List commits in an installed GitHub repository.',
    riskClass: 'read',
    requiredScopes: ['contents:read'],
    input: CommitListInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.listCommits',
        path: `${repositoryPath(input.owner, input.repo)}/commits`,
        query: {
          sha: input.sha,
          path: input.path,
          page: input.page,
          per_page: input.perPage,
        },
      }),
  }),
  defineNativeConnectorTool({
    name: 'create_or_update_file',
    description:
      'Create or update a UTF-8 file in an installed GitHub repository.',
    riskClass: 'send_external',
    requiredScopes: ['contents:write'],
    input: PutFileInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.putFile',
        method: 'PUT',
        path: `${repositoryPath(input.owner, input.repo)}/contents/${input.path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
        body: {
          message: input.message,
          content: base64Utf8(input.content),
          branch: input.branch,
          sha: input.sha,
        },
      }),
  }),
  defineNativeConnectorTool({
    name: 'delete_file',
    description: 'Delete a file from an installed GitHub repository.',
    riskClass: 'destructive',
    requiredScopes: ['contents:write'],
    input: DeleteFileInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.deleteFile',
        method: 'DELETE',
        path: `${repositoryPath(input.owner, input.repo)}/contents/${input.path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
        body: {
          message: input.message,
          sha: input.sha,
          branch: input.branch,
        },
      }),
  }),
  defineNativeConnectorTool({
    name: 'list_workflow_runs',
    description: 'List GitHub Actions workflow runs.',
    riskClass: 'read',
    requiredScopes: ['actions:read'],
    input: WorkflowRunsInput,
    handler: (input) => {
      let path = `${repositoryPath(input.owner, input.repo)}/actions/runs`
      if (input.workflowId !== undefined) {
        path = `${repositoryPath(input.owner, input.repo)}/actions/workflows/${encodeURIComponent(input.workflowId)}/runs`
      }
      return requestGitHub({
        operation: 'github.listWorkflowRuns',
        path,
        query: {
          branch: input.branch,
          status: input.status,
          page: input.page,
          per_page: input.perPage,
        },
      })
    },
  }),
  defineNativeConnectorTool({
    name: 'run_workflow',
    description: 'Dispatch a GitHub Actions workflow.',
    riskClass: 'send_external',
    requiredScopes: ['actions:write'],
    input: DispatchWorkflowInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.runWorkflow',
        method: 'POST',
        path: `${repositoryPath(input.owner, input.repo)}/actions/workflows/${encodeURIComponent(input.workflowId)}/dispatches`,
        body: { ref: input.ref, inputs: input.inputs },
      }),
  }),
  defineNativeConnectorTool({
    name: 'get_commit',
    description: 'Read a commit by SHA, branch, or tag.',
    riskClass: 'read',
    requiredScopes: ['contents:read'],
    input: RepositoryRefInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.getCommit',
        path: `${repositoryPath(input.owner, input.repo)}/commits/${encodeURIComponent(input.ref)}`,
      }),
  }),
  defineNativeConnectorTool({
    name: 'search_commits',
    description: 'Search commits in one installed GitHub repository.',
    riskClass: 'read',
    requiredScopes: ['contents:read'],
    input: ScopedSearchInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.searchCommits',
        path: '/search/commits',
        query: {
          q: `${input.query} repo:${input.owner}/${input.repo}`,
          page: input.page,
          per_page: input.perPage,
        },
      }),
  }),
  defineNativeConnectorTool({
    name: 'search_issues',
    description: 'Search issues in one installed GitHub repository.',
    riskClass: 'read',
    requiredScopes: ['issues:read'],
    input: ScopedSearchInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.searchIssues',
        path: '/search/issues',
        query: {
          q: `${input.query} repo:${input.owner}/${input.repo} is:issue`,
          page: input.page,
          per_page: input.perPage,
        },
      }),
  }),
  defineNativeConnectorTool({
    name: 'search_pull_requests',
    description: 'Search pull requests in one installed GitHub repository.',
    riskClass: 'read',
    requiredScopes: ['pull_requests:read'],
    input: ScopedSearchInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.searchPullRequests',
        path: '/search/issues',
        query: {
          q: `${input.query} repo:${input.owner}/${input.repo} is:pr`,
          page: input.page,
          per_page: input.perPage,
        },
      }),
  }),
  defineNativeConnectorTool({
    name: 'search_repositories',
    description: 'Search GitHub repositories available to the installation.',
    riskClass: 'read',
    requiredScopes: ['metadata:read'],
    input: RepositorySearchInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.searchRepositories',
        path: '/search/repositories',
        query: {
          q: input.query,
          page: input.page,
          per_page: input.perPage,
        },
      }),
  }),
  defineNativeConnectorTool({
    name: 'fork_repository',
    description: 'Fork a repository into an accessible organization.',
    riskClass: 'write',
    requiredScopes: ['contents:write'],
    input: ForkRepositoryInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.forkRepository',
        method: 'POST',
        path: `${repositoryPath(input.owner, input.repo)}/forks`,
        body: { organization: input.organization },
      }),
  }),
  defineNativeConnectorTool({
    name: 'list_releases',
    description: 'List releases in an installed GitHub repository.',
    riskClass: 'read',
    requiredScopes: ['contents:read'],
    input: RepositoryInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.listReleases',
        path: `${repositoryPath(input.owner, input.repo)}/releases`,
      }),
  }),
  defineNativeConnectorTool({
    name: 'get_latest_release',
    description: 'Read the latest release in an installed repository.',
    riskClass: 'read',
    requiredScopes: ['contents:read'],
    input: RepositoryInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.getLatestRelease',
        path: `${repositoryPath(input.owner, input.repo)}/releases/latest`,
      }),
  }),
  defineNativeConnectorTool({
    name: 'get_release_by_tag',
    description: 'Read a release by tag name.',
    riskClass: 'read',
    requiredScopes: ['contents:read'],
    input: RepositoryTagInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.getReleaseByTag',
        path: `${repositoryPath(input.owner, input.repo)}/releases/tags/${encodeURIComponent(input.tag)}`,
      }),
  }),
  defineNativeConnectorTool({
    name: 'list_tags',
    description: 'List tags in an installed GitHub repository.',
    riskClass: 'read',
    requiredScopes: ['contents:read'],
    input: RepositoryInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.listTags',
        path: `${repositoryPath(input.owner, input.repo)}/tags`,
      }),
  }),
  defineNativeConnectorTool({
    name: 'get_tag',
    description: 'Read one Git tag reference.',
    riskClass: 'read',
    requiredScopes: ['contents:read'],
    input: RepositoryTagInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.getTag',
        path: `${repositoryPath(input.owner, input.repo)}/git/ref/tags/${encodeURIComponent(input.tag)}`,
      }),
  }),
  defineNativeConnectorTool({
    name: 'list_repository_collaborators',
    description: 'List collaborators for an installed GitHub repository.',
    riskClass: 'read',
    requiredScopes: ['metadata:read'],
    input: RepositoryInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.listRepositoryCollaborators',
        path: `${repositoryPath(input.owner, input.repo)}/collaborators`,
      }),
  }),
  defineNativeConnectorTool({
    name: 'add_reply_to_pull_request_comment',
    description: 'Reply to a pull request review comment.',
    riskClass: 'send_external',
    requiredScopes: ['pull_requests:write'],
    input: PullRequestCommentReplyInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.replyToPullRequestComment',
        method: 'POST',
        path: `${repositoryPath(input.owner, input.repo)}/pulls/comments/${input.commentId}/replies`,
        body: { body: input.body },
      }),
  }),
  defineNativeConnectorTool({
    name: 'get_label',
    description: 'Read one repository label.',
    riskClass: 'read',
    requiredScopes: ['issues:read'],
    input: LabelInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.getLabel',
        path: `${repositoryPath(input.owner, input.repo)}/labels/${encodeURIComponent(input.label)}`,
      }),
  }),
  defineNativeConnectorTool({
    name: 'update_pull_request',
    description: 'Update a pull request title, body, state, or base branch.',
    riskClass: 'send_external',
    requiredScopes: ['pull_requests:write'],
    input: UpdatePullRequestInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.updatePullRequest',
        method: 'PATCH',
        path: `${repositoryPath(input.owner, input.repo)}/pulls/${input.pullNumber}`,
        body: {
          title: input.title,
          body: input.body,
          state: input.state,
          base: input.base,
        },
      }),
  }),
  defineNativeConnectorTool({
    name: 'update_pull_request_branch',
    description: 'Update a pull request branch from its base branch.',
    riskClass: 'write',
    requiredScopes: ['contents:write', 'pull_requests:write'],
    input: UpdatePullRequestBranchInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.updatePullRequestBranch',
        method: 'PUT',
        path: `${repositoryPath(input.owner, input.repo)}/pulls/${input.pullNumber}/update-branch`,
        body: { expected_head_sha: input.expectedHeadSha },
      }),
  }),
  defineNativeConnectorTool({
    name: 'sub_issue_write',
    description: 'Add or remove a sub-issue relationship.',
    riskClass: 'write',
    requiredScopes: ['issues:write'],
    input: SubIssueWriteInput,
    handler: (input) =>
      requestGitHub({
        operation: 'github.writeSubIssue',
        method: input.action === 'add' ? 'POST' : 'DELETE',
        path: `${repositoryPath(input.owner, input.repo)}/issues/${input.issueNumber}/sub_issue`,
        body: { sub_issue_id: input.subIssueId },
      }),
  }),
] as const
