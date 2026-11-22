import { Result } from 'better-result'
import { z } from 'zod'
import {
  ExecutionHostReceiver,
  type ExecutionHostError,
} from '@garden/server/execution-hosts'
import {
  hostEnrollmentSchema,
  hostLaunchSchema,
} from '@garden/core/execution-host/contracts'
import { serviceErrorResponse } from './service-error-response'
import type { AppRequestContext } from './context'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from './workspace-permissions'

const MAX_CONTROL_BODY_BYTES = 16_384
const response = (error: string, status: number) =>
  Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })

/** Preserve canonical service status mapping and keep private control failures out of caches. */
function controlFailure(error: ExecutionHostError) {
  const failure = serviceErrorResponse(error)
  failure.headers.set('Cache-Control', 'no-store')
  return failure
}

/** Control messages have bounded fixed fields. Reject oversized bodies before parsing them as JSON. */
async function readControlBody(request: Request) {
  const stream = request.body
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
      'application/json' ||
    !stream
  )
    return Result.err(response('A JSON control body is required', 400))
  const announced = request.headers.get('content-length')
  if (
    announced !== null &&
    (!/^\d+$/.test(announced) || Number(announced) > MAX_CONTROL_BODY_BYTES)
  )
    return Result.err(response('Control body is too large', 413))
  return Result.tryPromise({
    try: async () => {
      const reader = stream.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      const read = async () => {
        while (true) {
          const part = await reader.read()
          if (part.done) break
          total += part.value.byteLength
          if (total > MAX_CONTROL_BODY_BYTES) {
            await reader.cancel()
            return Result.err(response('Control body is too large', 413))
          }
          chunks.push(part.value)
        }
        const combined = new Uint8Array(total)
        let offset = 0
        for (const chunk of chunks) {
          combined.set(chunk, offset)
          offset += chunk.byteLength
        }
        const parsed: unknown = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(combined),
        )
        return Result.ok(parsed)
      }
      return read().finally(() => reader.releaseLock())
    },
    catch: () => response('Invalid JSON control body', 400),
  }).then((result) => Result.flatten(result))
}

/** Fresh database-backed sessions prevent a still-signed cookie cache from reviving a revoked session. */
async function requireFreshPilot(
  context: AppRequestContext,
  workspaceId: string,
  mutation: boolean,
) {
  const configured = z
    .string()
    .uuid()
    .safeParse(context.env.ENGINEERING_PILOT_OPERATOR_ID)
  if (!configured.success)
    return Result.err(response('The engineering pilot is not configured', 503))
  if (mutation) {
    const origin = context.request.headers.get('origin')
    const expected = new URL(context.env.BETTER_AUTH_URL ?? context.request.url)
      .origin
    if (origin !== expected && origin !== 'garden-mobile://')
      return Result.err(response('Request origin is not permitted', 403))
  }
  const session = await Result.tryPromise({
    try: async () =>
      (await context.auth.getAuth()).api.getSession({
        headers: context.request.headers,
        query: { disableCookieCache: true },
      }),
    catch: () => response('Session verification is unavailable', 503),
  })
  if (session.isErr()) return session
  if (!session.value) return Result.err(response('Unauthorized', 401))
  if (session.value.user.id !== configured.data)
    return Result.err(response('This operator is outside the pilot', 403))
  const permission = await requireWorkspacePermission({
    appContext: context,
    request: context.request,
    workspaceId,
    permissions: workspacePermissions.permissionManage,
  })
  if (permission) return Result.err(permission)
  return Result.ok({
    actorId: session.value.user.id,
    receiver: new ExecutionHostReceiver(
      await context.db(),
      configured.data,
      session.value.session.id,
    ),
  })
}

/** Explicit headers prevent active-workspace fallback when a client changes accounts or workspaces. */
function workspaceHeader(request: Request) {
  const parsed = z
    .string()
    .uuid()
    .safeParse(request.headers.get('X-Workspace-ID'))
  return parsed.success
    ? Result.ok(parsed.data)
    : Result.err(response('An explicit workspace ID is required', 400))
}

/** Browser/member effects and host-signed delivery share one receiver with separate authentication boundaries. */
export async function handleExecutionHostAction(
  context: AppRequestContext,
  action: 'enroll' | 'launch' | 'revoke' | 'receive',
) {
  const body = await readControlBody(context.request)
  if (body.isErr()) return body.error
  if (action === 'receive') {
    const configured = z
      .string()
      .uuid()
      .safeParse(context.env.ENGINEERING_PILOT_OPERATOR_ID)
    if (!configured.success)
      return response('The engineering pilot is not configured', 503)
    const result = await new ExecutionHostReceiver(
      await context.db(),
      configured.data,
    ).receive(body.value, Date.now())
    return result.match({
      ok: (value) =>
        Response.json(value, { headers: { 'Cache-Control': 'no-store' } }),
      err: controlFailure,
    })
  }
  const workspace = workspaceHeader(context.request)
  if (workspace.isErr()) return workspace.error
  const pilot = await requireFreshPilot(context, workspace.value, true)
  if (pilot.isErr()) return pilot.error
  if (action === 'enroll') {
    const parsed = hostEnrollmentSchema.safeParse(body.value)
    if (!parsed.success || parsed.data.workspaceId !== workspace.value)
      return response('Invalid enrollment scope', 400)
    const result = await pilot.value.receiver.enroll(
      pilot.value.actorId,
      parsed.data,
    )
    return result.match({
      ok: (value) =>
        Response.json(value, { headers: { 'Cache-Control': 'no-store' } }),
      err: controlFailure,
    })
  }
  if (action === 'launch') {
    const parsed = hostLaunchSchema.safeParse(body.value)
    if (!parsed.success || parsed.data.workspaceId !== workspace.value)
      return response('Invalid launch scope', 400)
    const result = await pilot.value.receiver.launch(
      pilot.value.actorId,
      parsed.data,
      Date.now(),
    )
    return result.match({
      ok: (value) =>
        Response.json(value, { headers: { 'Cache-Control': 'no-store' } }),
      err: controlFailure,
    })
  }
  const parsed = z
    .strictObject({ hostId: z.string().uuid() })
    .safeParse(body.value)
  if (!parsed.success) return response('Invalid host identity', 400)
  const result = await pilot.value.receiver.revoke(
    pilot.value.actorId,
    workspace.value,
    parsed.data.hostId,
    Date.now(),
  )
  return result.match({
    ok: (value) =>
      Response.json(value, { headers: { 'Cache-Control': 'no-store' } }),
    err: controlFailure,
  })
}

/** Snapshot pagination returns its own next cursor rather than advancing a client to the undelivered event head. */
export async function handleExecutionHostRun(
  context: AppRequestContext,
  launchId: string,
  action: 'snapshot' | 'cancel' | 'interventions' | 'answer',
) {
  if (!z.string().uuid().safeParse(launchId).success)
    return response('Invalid launch identity', 400)
  const workspace = workspaceHeader(context.request)
  if (workspace.isErr()) return workspace.error
  const pilot = await requireFreshPilot(
    context,
    workspace.value,
    action === 'cancel' || action === 'answer',
  )
  if (pilot.isErr()) return pilot.error
  if (action === 'answer') {
    const body = await readControlBody(context.request)
    if (body.isErr()) return body.error
    const result = await pilot.value.receiver.answer(
      pilot.value.actorId,
      workspace.value,
      launchId,
      body.value,
      Date.now(),
    )
    if (result.isErr()) return controlFailure(result.error)
    return Response.json(result.value, {
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  if (action === 'interventions') {
    const result = await pilot.value.receiver.interventions(
      pilot.value.actorId,
      workspace.value,
      launchId,
      Date.now(),
    )
    if (result.isErr()) return controlFailure(result.error)
    return Response.json(result.value, {
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  if (action === 'cancel') {
    const body = await readControlBody(context.request)
    if (body.isErr()) return body.error
    const parsed = z
      .strictObject({ commandId: z.string().uuid() })
      .safeParse(body.value)
    if (!parsed.success) return response('Invalid cancellation identity', 400)
    const result = await pilot.value.receiver.cancel(
      pilot.value.actorId,
      workspace.value,
      launchId,
      parsed.data.commandId,
      Date.now(),
    )
    return result.match({
      ok: (value) =>
        Response.json(value, { headers: { 'Cache-Control': 'no-store' } }),
      err: controlFailure,
    })
  }
  const after = Number(
    new URL(context.request.url).searchParams.get('after') ?? '0',
  )
  const result = await pilot.value.receiver.snapshot(
    pilot.value.actorId,
    workspace.value,
    launchId,
    after,
  )
  // The receiver returns a union of result types. A direct branch keeps the
  // call typed in every compiler run; `match` on that union did not.
  if (result.isErr()) return controlFailure(result.error)
  return Response.json(result.value, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

/** Discovery exposes only hosts in the explicitly selected and currently authorized workspace. */
export async function handleExecutionHostDirectory(context: AppRequestContext) {
  const workspace = workspaceHeader(context.request)
  if (workspace.isErr()) return workspace.error
  const pilot = await requireFreshPilot(context, workspace.value, false)
  if (pilot.isErr()) return pilot.error
  const after =
    new URL(context.request.url).searchParams.get('afterHostId') ?? undefined
  const result = await pilot.value.receiver.directory(
    pilot.value.actorId,
    workspace.value,
    Date.now(),
    after,
  )
  // The receiver returns a union of result types. A direct branch keeps the
  // call typed in every compiler run; `match` on that union did not.
  if (result.isErr()) return controlFailure(result.error)
  return Response.json(result.value, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
