import { Effect } from 'effect'
import { createFileRoute } from '@tanstack/react-router'
import { decodeOAuthCallbackState, OAuthState } from '@executor-js/sdk/core'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  requireWorkspaceAccess,
  requireWorkspaceContext,
} from '@/lib/server/control-plane'
import { executorProgram } from '@/lib/server/executor-runtime'

const callbackHtml = (result: {
  readonly ok: boolean
  readonly error?: string
}) =>
  `<!doctype html><html><body><script>
const result = ${JSON.stringify(result).replace(/</g, '\\u003c')};
if (window.opener) {
  window.opener.postMessage({ type: 'executor-oauth', ...result }, window.location.origin);
  window.close();
} else {
  window.location.replace('/workspace');
}
</script></body></html>`

/** Completes or cancels one OAuth callback inside Garden's request-scoped Executor. */
export const settleOAuthCallback = Effect.fn('ExecutorOAuth.settleCallback')(
  function* (input: {
    readonly identity: { readonly tenant: string; readonly subject: string }
    readonly state: string
    readonly providerError: string | null
    readonly providerErrorDescription: string | null
    readonly code: string | null
    readonly callbackDomain?: string
  }) {
    const state = OAuthState.make(input.state)
    if (input.providerError !== null || input.code === null) {
      yield* executorProgram(input.identity, (executor) =>
        executor.oauth.cancel(state),
      )
      return {
        ok: false as const,
        error:
          input.providerErrorDescription ??
          input.providerError ??
          'OAuth authorization was cancelled.',
      }
    }

    const code = input.code
    yield* executorProgram(input.identity, (executor) =>
      executor.oauth.complete({
        state,
        code,
        ...(input.callbackDomain === undefined
          ? {}
          : { callbackDomain: input.callbackDomain }),
      }),
    )
    return { ok: true as const }
  },
)

export const Route = createFileRoute('/api/oauth/callback')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const params = new URL(request.url).searchParams
        const stateValue = params.get('state')
        if (!stateValue) {
          return Response.json(
            { error: 'Missing OAuth state' },
            { status: 400 },
          )
        }
        const callbackState = decodeOAuthCallbackState(stateValue)
        const workspaceId = callbackState?.orgSlug
        const workspaceContext = workspaceId
          ? await requireWorkspaceAccess(appContext, workspaceId)
          : await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext
        const resolvedWorkspaceId =
          workspaceId ??
          ('workspaceId' in workspaceContext
            ? workspaceContext.workspaceId
            : null)
        if (!resolvedWorkspaceId) {
          return Response.json(
            { error: 'OAuth workspace could not be restored' },
            { status: 400 },
          )
        }

        const result = await Effect.runPromise(
          settleOAuthCallback({
            identity: {
              tenant: resolvedWorkspaceId,
              subject: workspaceContext.session.user.id,
            },
            state: callbackState?.state ?? stateValue,
            providerError: params.get('error'),
            providerErrorDescription: params.get('error_description'),
            code: params.get('code'),
            callbackDomain:
              params.get('domain') ?? params.get('site') ?? undefined,
          }),
        )
        return new Response(callbackHtml(result), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      },
    },
  },
})
