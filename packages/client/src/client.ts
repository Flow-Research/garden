import { Result, TaggedError } from 'better-result'
import { z } from 'zod'

/** Read projections of existing Garden responses, not WorkStream tasks. */
export const workspacePreviewSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
})
export const taskPreviewSchema = z.object({
  id: z.string().min(1),
  workspace_id: z.string().min(1),
  title: z.string(),
  identifier: z.string(),
  status: z.enum([
    'todo',
    'in_progress',
    'in_review',
    'done',
    'blocked',
    'cancelled',
  ]),
  updated_at: z.string(),
})
export const runPreviewSchema = z.object({
  id: z.string().min(1),
  workspace_id: z.string().min(1),
  issue_id: z.string().min(1),
  status: z.string().min(1),
  cancel_requested_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  updated_at: z.string(),
})
export const threadPreviewSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  title: z.string(),
})
/** Existing owned chat facets, never an external execution host. */
export const chatThreadTargetSchema = threadPreviewSchema.extend({
  ownerUserId: z.string().min(1),
  hostName: z.string().regex(/^[A-Za-z0-9._:-]+$/),
  runtime_kind: z.enum(['chat', 'issue_run']),
  runtime_key: z.string().uuid(),
})
export type ChatThreadTarget = z.infer<typeof chatThreadTargetSchema>

/** Encodes the server-provided host as one route segment. */
export function chatAgentPath(hostName: string) {
  return `/agents/agent-d-o/${encodeURIComponent(hostName)}`
}

/** Matches the existing SDK facet route without accepting arbitrary paths. */
export function chatFacetPath(thread: ChatThreadTarget) {
  return `${chatAgentPath(thread.hostName)}/sub/chat-sub-agent/${encodeURIComponent(thread.runtime_key)}`
}

export type WorkspacePreview = z.infer<typeof workspacePreviewSchema>
export type TaskPreview = z.infer<typeof taskPreviewSchema>
export type RunPreview = z.infer<typeof runPreviewSchema>

export class ClientReadFailure extends TaggedError('ClientReadFailure')<{
  code:
    | 'transport'
    | 'session-ended'
    | 'unauthorized'
    | 'forbidden'
    | 'response'
  message: string
}>() {}

export interface ReadClientOptions {
  origin: string
  accountId: string
  workspaceId: string | null
  sessionId: string
  fetch: typeof globalThis.fetch
  createRequestId: () => string
  onAuthorityLost: () => void
}

/**
 * Accepts an HTTPS origin or a loopback development origin. Native callers
 * must not send their session cookies to a path, userinfo, or another origin.
 */
export function parseGardenOrigin(value: string) {
  return Result.try({
    try: () => new URL(value),
    catch: () =>
      new ClientReadFailure({
        code: 'transport',
        message: 'Invalid Garden origin',
      }),
  }).andThen((url) => {
    if (
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        ))
    )
      return Result.err(
        new ClientReadFailure({
          code: 'transport',
          message: 'Use an HTTPS Garden origin or loopback development origin',
        }),
      )
    return Result.ok(url.origin)
  })
}

/**
 * Reuses the immutable session boundary from createSkillsClient for additional
 * existing reads and explicit chat creation. No browser singleton, Worker
 * binding, or credential storage enters this module. The controller checks
 * fresh authority before chat operations. The server remains authoritative.
 * See docs/decisions/2026-11-shared-client-session.md.
 */
export function createGardenClient(input: ReadClientOptions) {
  const options = Object.freeze({ ...input })
  const scope = Object.freeze({
    origin: options.origin,
    accountId: options.accountId,
    workspaceId: options.workspaceId,
    sessionId: options.sessionId,
  })
  const lifetime = new AbortController()

  /** Cancels in-flight reads without touching the host's independent run. */
  function invalidate() {
    lifetime.abort()
  }

  /** Decodes at the transport edge and refuses late or cross-workspace data. */
  async function read<T>(
    path: string,
    schema: z.ZodType<T>,
    workspaceScoped = true,
    mutation?: { method: 'POST'; body: string },
  ) {
    return Result.gen(async function* () {
      const origin = yield* parseGardenOrigin(scope.origin)
      if (
        lifetime.signal.aborted ||
        !scope.accountId ||
        (workspaceScoped && !scope.workspaceId) ||
        !scope.sessionId
      ) {
        return Result.err(
          new ClientReadFailure({
            code: 'session-ended',
            message: 'Client session ended',
          }),
        )
      }
      const response = yield* Result.await(
        Result.tryPromise({
          try: () =>
            options.fetch(`${origin}${path}`, {
              method: mutation?.method ?? 'GET',
              ...(mutation ? { body: mutation.body } : {}),
              credentials: 'include',
              redirect: 'error',
              signal: lifetime.signal,
              headers: {
                ...(workspaceScoped && scope.workspaceId
                  ? { 'X-Workspace-ID': scope.workspaceId }
                  : {}),
                'X-Request-ID': options.createRequestId(),
                ...(mutation ? { 'Content-Type': 'application/json' } : {}),
              },
            }),
          catch: () =>
            new ClientReadFailure({
              code: 'transport',
              message: 'Garden could not be reached',
            }),
        }),
      )
      if (lifetime.signal.aborted) {
        return Result.err(
          new ClientReadFailure({
            code: 'session-ended',
            message: 'Client session ended',
          }),
        )
      }
      if (response.status === 401 || response.status === 403) {
        invalidate()
        options.onAuthorityLost()
        return Result.err(
          new ClientReadFailure({
            code: response.status === 401 ? 'unauthorized' : 'forbidden',
            message: 'Refresh sign-in and workspace access',
          }),
        )
      }
      if (!response.ok)
        return Result.err(
          new ClientReadFailure({
            code: 'response',
            message: `Garden returned HTTP ${response.status}`,
          }),
        )
      const payload = yield* Result.await(
        Result.tryPromise({
          try: () => response.json() as Promise<unknown>,
          catch: () =>
            new ClientReadFailure({
              code: 'response',
              message: 'Garden returned invalid JSON',
            }),
        }),
      )
      if (lifetime.signal.aborted)
        return Result.err(
          new ClientReadFailure({
            code: 'session-ended',
            message: 'Client session ended',
          }),
        )
      const parsed = schema.safeParse(payload)
      return parsed.success
        ? Result.ok(parsed.data)
        : Result.err(
            new ClientReadFailure({
              code: 'response',
              message: 'Garden returned an invalid or wrong-workspace response',
            }),
          )
    })
  }

  const taskList = z.object({
    issues: z.array(
      taskPreviewSchema.refine(
        (task) => task.workspace_id === scope.workspaceId,
      ),
    ),
  })
  const activeRun = z.object({
    run: runPreviewSchema
      .refine((run) => run.workspace_id === scope.workspaceId)
      .nullable(),
  })

  return {
    scope,
    invalidate,
    listWorkspaces: () =>
      read('/api/workspaces', z.array(workspacePreviewSchema), false),
    listTasks: () =>
      read(
        `/api/issues?workspace_id=${encodeURIComponent(scope.workspaceId ?? '')}&limit=50`,
        taskList,
      ),
    getActiveRun: (issueId: string) =>
      read(
        `/api/issues/${encodeURIComponent(issueId)}/active-run`,
        activeRun.refine((data) => !data.run || data.run.issue_id === issueId),
      ),
    /** Reads one historical run without substituting a newer active run. */
    getRun: async (issueId: string, runId: string) => {
      const page = await read(
        `/api/issues/${encodeURIComponent(issueId)}/runs`,
        z.array(
          runPreviewSchema.refine(
            (run) =>
              run.workspace_id === scope.workspaceId &&
              run.issue_id === issueId,
          ),
        ),
      )
      return page.map((runs) => runs.find((run) => run.id === runId) ?? null)
    },
    listChatTargets: () =>
      read(
        `/api/chat/threads?workspace_id=${encodeURIComponent(scope.workspaceId ?? '')}`,
        z.array(
          chatThreadTargetSchema.refine(
            (thread) =>
              thread.workspaceId === scope.workspaceId &&
              thread.ownerUserId === scope.accountId,
          ),
        ),
      ),
    /** Caller supplies a stable ID and reconciles unknown acknowledgement by reading. */
    createChatThread: (id: string) => {
      if (!z.string().uuid().safeParse(id).success)
        return Promise.resolve(
          Result.err(
            new ClientReadFailure({
              code: 'response',
              message: 'Invalid chat identity',
            }),
          ),
        )
      return read(
        '/api/chat/threads',
        chatThreadTargetSchema.refine(
          (thread) =>
            thread.id === id &&
            thread.runtime_key === id &&
            thread.runtime_kind === 'chat' &&
            thread.workspaceId === scope.workspaceId &&
            thread.ownerUserId === scope.accountId,
        ),
        true,
        { method: 'POST', body: JSON.stringify({ id }) },
      )
    },
    listThreads: () =>
      read(
        `/api/chat/threads?workspace_id=${encodeURIComponent(scope.workspaceId ?? '')}`,
        z.array(
          threadPreviewSchema.refine(
            (thread) => thread.workspaceId === scope.workspaceId,
          ),
        ),
      ),
  }
}
