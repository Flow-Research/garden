import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import type {
  Agent,
  Issue,
  ListIssuesResponse,
  MemberWithUser,
  Workspace,
} from '@garden/core/types'
import { workspaceKeys } from '@/lib/workspace/queries'
import { issueKeys } from '@/lib/issues/queries'
import { createEditorExtensions } from './index'
import { createMentionSuggestion } from './mention-suggestion'

/**
 * Guards the shared factory's surface. Every consumer (issues, comments,
 * create-issue) gets the same extension set, and the factory has no opt-in
 * flags left: the chat composer's `textAlign` and `skillSuggestion` additions
 * went out with the composer's move back to a textarea (2026-09-17 review).
 * If this snapshot changes without a matching consumer review, that's a
 * regression.
 *
 * NOTE: these are TOP-LEVEL extension names only. StarterKit is a single
 * extension named 'starterKit' that registers bold/italic/underline/heading
 * etc. via addExtensions() — those names never appear here. Do not assert on
 * them.
 *
 * The stub onUploadFileRef is required: createEditorExtensions calls
 * createFileUploadExtension(options.onUploadFileRef!) behind a non-null
 * assertion, so omitting it hands the extension `undefined`.
 */
function extensionNames(opts: Parameters<typeof createEditorExtensions>[0]) {
  return createEditorExtensions({
    onUploadFileRef: { current: undefined },
    ...opts,
  })
    .map((ext) => ext.name)
    .sort()
}

describe('createEditorExtensions', () => {
  it('builds the same extension set for every consumer', () => {
    const names = extensionNames({ editable: true })
    // Rich-text-only extras the chat composer used to switch on. Nothing
    // enables them any more, and no consumer should reintroduce them without
    // owning the per-keystroke cost that came with the last attempt.
    expect(names).not.toContain('textAlign')
    expect(names).not.toContain('skillSuggestion')
    // The pieces every consumer does rely on.
    expect(names).toContain('starterKit')
    expect(names).toContain('mention')
    expect(names).toContain('markdown')
  })

  // NO underline assertion here. StarterKit 3.22.4 does bundle Underline
  // (verified: it is a dependency in node_modules/@tiptap/starter-kit/
  // package.json), but StarterKit is ONE extension named 'starterKit' and its
  // children never appear in the returned array — `toContain('underline')`
  // cannot pass.

  it('readonly mode drops the edit-only extensions', () => {
    const names = extensionNames({ editable: false })
    expect(names).not.toContain('placeholder')
    expect(names).toContain('starterKit')
  })
})

/**
 * The mention popup is shared with issues / comments / create-issue, which must
 * keep offering members + agents + issues + @all. `createMentionSuggestion`
 * can still be narrowed to a subset, so guard both directions.
 *
 * Fixtures: a workspace is seeded into useWorkspaceStore (createMentionSuggestion
 * reads `useWorkspaceStore.getState().workspace?.id`), and the query cache is
 * primed with one candidate for each of workspaceKeys.members/.agents and
 * issueKeys.list, matching the shapes createMentionSuggestion reads
 * (MemberWithUser, Agent, ListIssuesResponse) — copied from
 * mention-suggestion.tsx's reads.
 */
describe('createMentionSuggestion types filter', () => {
  const wsId = 'ws-1'

  const workspace: Workspace = {
    id: wsId,
    name: 'Test Workspace',
    slug: 'test-workspace',
    description: null,
    context: null,
    settings: {},
    issue_prefix: 'TST',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }

  const member: MemberWithUser = {
    id: 'member-1',
    workspace_id: wsId,
    user_id: 'user-1',
    role: 'member',
    created_at: '2026-01-01T00:00:00.000Z',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    avatar_url: null,
  }

  const agent: Agent = {
    id: 'agent-1',
    workspace_id: wsId,
    reports_to: null,
    runtime_id: 'runtime-1',
    name: 'Ada Bot',
    description: '',
    instructions: '',
    avatar_url: null,
    runtime_mode: 'local',
    runtime_config: {},
    custom_env: {},
    custom_args: [],
    custom_env_redacted: false,
    visibility: 'workspace',
    status: 'idle',
    record_status: 'active',
    is_default: false,
    max_concurrent_tasks: 1,
    owner_id: null,
    permissions: null,
    skills: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
    archived_by: null,
  }

  const issue: Issue = {
    id: 'issue-1',
    workspace_id: wsId,
    team_id: null,
    number: 1,
    identifier: 'TST-1',
    title: 'Fix the thing',
    description: null,
    status: 'todo',
    priority: 'medium',
    assignee_type: null,
    assignee_id: null,
    creator_type: 'member',
    creator_id: 'user-1',
    parent_issue_id: null,
    project_id: null,
    position: 'a0',
    due_date: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }

  const issuesResponse: ListIssuesResponse = {
    issues: [issue],
    total: 1,
  }

  function makeQueryClient() {
    useWorkspaceStore.setState({ workspace })
    const qc = new QueryClient()
    qc.setQueryData(workspaceKeys.members(wsId), [member])
    qc.setQueryData(workspaceKeys.agents(wsId), [agent])
    qc.setQueryData(issueKeys.list(wsId), issuesResponse)
    return qc
  }

  it('offers every type by default', async () => {
    const qc = makeQueryClient()
    const items = await createMentionSuggestion(qc).items!({
      query: '',
      editor: null as never,
    })
    expect(new Set(items.map((i) => i.type))).toEqual(
      new Set(['all', 'member', 'agent', 'issue']),
    )
  })

  it('offers only the requested types', async () => {
    const qc = makeQueryClient()
    const items = await createMentionSuggestion(qc, { types: ['member'] })
      .items!({
      query: '',
      editor: null as never,
    })
    expect(items.every((i) => i.type === 'member')).toBe(true)
  })
})
