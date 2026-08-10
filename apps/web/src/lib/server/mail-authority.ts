import { MailActor, MemberId, WorkspaceId } from '@garden/core/mail'
import type { GardenDatabase } from '@garden/db'
import { schema } from '@garden/db/runtime'
import { and, eq } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import type { AppRequestContext } from './context'

/** Request did not carry an authenticated Garden member. */
export class MailRequestUnauthorizedError extends Schema.TaggedErrorClass<MailRequestUnauthorizedError>()(
  'MailRequestUnauthorizedError',
  { message: Schema.String },
) {}

/** Authenticated member does not belong to the requested workspace. */
export class MailRequestForbiddenError extends Schema.TaggedErrorClass<MailRequestForbiddenError>()(
  'MailRequestForbiddenError',
  {
    workspaceId: WorkspaceId,
    message: Schema.String,
  },
) {}

/** Request-scoped auth or Hyperdrive access failed before mail could run. */
export class MailRequestBoundaryError extends Schema.TaggedErrorClass<MailRequestBoundaryError>()(
  'MailRequestBoundaryError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export type MailMemberAuthority = {
  db: GardenDatabase
  actor: typeof MailActor.cases.Member.Type
  role: string
}

/**
 * Derives canonical mail authority from the request session and membership row.
 * Callers provide only a workspace id; they cannot impersonate another member
 * by constructing a `MailActor`. The same database instance is returned so the
 * authenticated check and Effect repository layer share request-scoped
 * Hyperdrive lifecycle.
 */
export const requireMailMemberAuthority = Effect.fn(
  'GardenMail.requireMailMemberAuthority',
)(function* (context: AppRequestContext, workspaceId: typeof WorkspaceId.Type) {
  const session = yield* Effect.tryPromise({
    try: () => context.auth.getSession(),
    catch: (cause) =>
      new MailRequestBoundaryError({
        operation: 'session',
        message: 'Garden could not resolve the mail request session.',
        cause,
      }),
  })
  if (!session?.user) {
    return yield* new MailRequestUnauthorizedError({
      message: 'Authentication required.',
    })
  }

  const db = yield* Effect.tryPromise({
    try: () => context.db(),
    catch: (cause) =>
      new MailRequestBoundaryError({
        operation: 'database.connect',
        message: 'Garden could not connect to the mail database.',
        cause,
      }),
  })
  const memberships = yield* Effect.tryPromise({
    try: () =>
      db
        .select({ id: schema.member.id, role: schema.member.role })
        .from(schema.member)
        .where(
          and(
            eq(schema.member.organizationId, workspaceId),
            eq(schema.member.userId, session.user.id),
          ),
        )
        .limit(1),
    catch: (cause) =>
      new MailRequestBoundaryError({
        operation: 'membership',
        message: 'Garden could not authorize the mail workspace.',
        cause,
      }),
  })
  const membership = memberships[0]
  if (!membership) {
    return yield* new MailRequestForbiddenError({
      workspaceId,
      message: 'Workspace access denied.',
    })
  }

  const actor = yield* Schema.decodeUnknownEffect(MailActor.cases.Member)({
    _tag: 'Member',
    memberId: MemberId.make(membership.id),
  }).pipe(
    Effect.mapError(
      (cause) =>
        new MailRequestBoundaryError({
          operation: 'actor.decode',
          message: 'Garden membership could not become a mail actor.',
          cause,
        }),
    ),
  )

  return { db, actor, role: membership.role } satisfies MailMemberAuthority
})

/** Owner/admin authorization for provider and mailbox provisioning mutations. */
export const requireMailAdministrator = Effect.fn(
  'GardenMail.requireMailAdministrator',
)(function* (
  authority: MailMemberAuthority,
  workspaceId: typeof WorkspaceId.Type,
) {
  if (authority.role === 'owner' || authority.role === 'admin') return authority
  return yield* new MailRequestForbiddenError({
    workspaceId,
    message: 'Workspace owner or admin access required.',
  })
})
