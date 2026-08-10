import type { GardenDatabase } from '@garden/db'
import {
  mailConversation,
  mailConversationAssignment,
  mailConversationMessage,
  mailConversationState,
} from '@garden/db/schema'
import {
  MailboxId,
  type AssignConversationInput,
  type MailActor,
  type UnassignConversationInput,
  type UpdateConversationStateInput,
} from '@garden/core/mail'
import { and, eq, isNull } from 'drizzle-orm'
import { Effect } from 'effect'
import {
  AssignmentSnapshot,
  ConversationActorState,
  MailRepositoryInvariantError,
  MailRepositoryNotFoundError,
  MailRepositoryPersistenceError,
} from './contracts.ts'
import {
  actionActorValue,
  conversationStateValue,
  databaseEffect,
  decodeRow,
  inTransaction,
  mailActorValue,
  requireConversationAccess,
  requireMailboxAccess,
  stateActorPredicate,
  storedActionActor,
  storedActor,
  timestamp,
} from './shared.ts'

/** Converts a persisted state row through the public actor-state contract. */
const decodeConversationState = (
  row: typeof mailConversationState.$inferSelect,
): Effect.Effect<ConversationActorState, MailRepositoryPersistenceError> =>
  decodeRow(
    ConversationActorState,
    conversationStateValue(row),
    'updateConversationState.decode',
  )

/** Upserts read/archive state owned exclusively by the requesting actor. */
export const updateConversationState = Effect.fn(
  'MailRepository.updateConversationState',
)(function* (db: GardenDatabase, input: UpdateConversationStateInput) {
  return yield* inTransaction(db, 'updateConversationState', (tx) =>
    Effect.gen(function* () {
      yield* requireConversationAccess(tx, {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        actor: input.actor,
        write: false,
        operation: 'updateConversationState.authorize',
      })
      if (input.lastReadMessageId !== null) {
        const lastReadMessageId = input.lastReadMessageId
        const projected = yield* databaseEffect(
          'updateConversationState.validateLastRead',
          () =>
            tx
              .select({ messageId: mailConversationMessage.messageId })
              .from(mailConversationMessage)
              .where(
                and(
                  eq(
                    mailConversationMessage.conversationId,
                    input.conversationId,
                  ),
                  eq(mailConversationMessage.messageId, lastReadMessageId),
                ),
              )
              .limit(1),
        )
        if (projected.length === 0) {
          return yield* new MailRepositoryInvariantError({
            operation: 'updateConversationState.validateLastRead',
            message:
              'Last-read message is not projected into this conversation.',
          })
        }
      }
      const actor = storedActor(input.actor)
      const values = {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        actorType: actor.actorType,
        memberId: actor.memberId,
        agentId: actor.agentId,
        lastReadMessageId: input.lastReadMessageId,
        readAt: input.readAt === null ? null : new Date(input.readAt),
        archivedAt:
          input.archivedAt === null ? null : new Date(input.archivedAt),
        mutedAt: input.mutedAt === null ? null : new Date(input.mutedAt),
        pinned: input.pinned,
        updatedAt: new Date(),
      }
      const current = yield* databaseEffect(
        'updateConversationState.find',
        () =>
          tx
            .select()
            .from(mailConversationState)
            .where(
              and(
                eq(mailConversationState.conversationId, input.conversationId),
                stateActorPredicate(input.actor),
              ),
            )
            .limit(1),
      )
      const currentState = current[0]
      const rows =
        currentState === undefined
          ? yield* databaseEffect('updateConversationState.insert', () =>
              tx.insert(mailConversationState).values(values).returning(),
            )
          : yield* databaseEffect('updateConversationState.update', () =>
              tx
                .update(mailConversationState)
                .set(values)
                .where(eq(mailConversationState.id, currentState.id))
                .returning(),
            )
      const state = rows[0]
      if (state === undefined) {
        return yield* new MailRepositoryInvariantError({
          operation: 'updateConversationState',
          message: 'Conversation state mutation returned no row.',
        })
      }
      return yield* decodeConversationState(state)
    }),
  )
})

/** Builds the active-assignment predicate for a member or agent. */
const assignmentActorPredicate = (actor: MailActor) =>
  actor._tag === 'Member'
    ? and(
        eq(mailConversationAssignment.assigneeType, 'member'),
        eq(mailConversationAssignment.assigneeMemberId, actor.memberId),
      )
    : and(
        eq(mailConversationAssignment.assigneeType, 'agent'),
        eq(mailConversationAssignment.assigneeAgentId, actor.agentId),
      )

/** Decodes assignment attribution while keeping historical closure explicit. */
const decodeAssignment = (
  assignment: typeof mailConversationAssignment.$inferSelect,
): Effect.Effect<AssignmentSnapshot, MailRepositoryPersistenceError> =>
  decodeRow(
    AssignmentSnapshot,
    {
      id: assignment.id,
      conversationId: assignment.conversationId,
      assignee: mailActorValue({
        actorType: assignment.assigneeType,
        memberId: assignment.assigneeMemberId,
        agentId: assignment.assigneeAgentId,
      }),
      assignedBy: actionActorValue({
        actorType: assignment.assignedByType,
        memberId: assignment.assignedByMemberId,
        agentId: assignment.assignedByAgentId,
      }),
      assignedAt: timestamp(assignment.assignedAt),
      unassignedAt: timestamp(assignment.unassignedAt),
    },
    'assignment.decode',
  )

/** Assigns an accessible actor to a conversation with auditable attribution. */
export const assignConversation = Effect.fn(
  'MailRepository.assignConversation',
)(function* (db: GardenDatabase, input: AssignConversationInput) {
  return yield* inTransaction(db, 'assignConversation', (tx) =>
    Effect.gen(function* () {
      const conversation =
        input.assignedBy._tag === 'System'
          ? (yield* databaseEffect('assignConversation.find', () =>
              tx
                .select()
                .from(mailConversation)
                .where(
                  and(
                    eq(mailConversation.workspaceId, input.workspaceId),
                    eq(mailConversation.id, input.conversationId),
                  ),
                )
                .limit(1),
            ))[0]
          : yield* requireConversationAccess(tx, {
              workspaceId: input.workspaceId,
              conversationId: input.conversationId,
              actor: input.assignedBy,
              write: true,
              operation: 'assignConversation.authorize',
            })
      if (conversation === undefined) {
        return yield* new MailRepositoryNotFoundError({
          entity: 'conversation',
          id: input.conversationId,
          operation: 'assignConversation',
          message: 'Conversation does not exist.',
        })
      }
      yield* requireMailboxAccess(tx, {
        workspaceId: input.workspaceId,
        mailboxId: MailboxId.make(conversation.mailboxId),
        actor: input.assignee,
        write: false,
        operation: 'assignConversation.validateAssignee',
      })
      const existing = yield* databaseEffect(
        'assignConversation.findActive',
        () =>
          tx
            .select()
            .from(mailConversationAssignment)
            .where(
              and(
                eq(
                  mailConversationAssignment.conversationId,
                  input.conversationId,
                ),
                isNull(mailConversationAssignment.unassignedAt),
                assignmentActorPredicate(input.assignee),
              ),
            )
            .limit(1),
      )
      if (existing[0] !== undefined) {
        return yield* decodeAssignment(existing[0])
      }
      const assignee = storedActor(input.assignee)
      const assignedBy = storedActionActor(input.assignedBy)
      const rows = yield* databaseEffect('assignConversation.insert', () =>
        tx
          .insert(mailConversationAssignment)
          .values({
            workspaceId: input.workspaceId,
            conversationId: input.conversationId,
            assigneeType: assignee.actorType,
            assigneeMemberId: assignee.memberId,
            assigneeAgentId: assignee.agentId,
            assignedByType: assignedBy.actorType,
            assignedByMemberId: assignedBy.memberId,
            assignedByAgentId: assignedBy.agentId,
          })
          .returning(),
      )
      const assignment = rows[0]
      if (assignment === undefined) {
        return yield* new MailRepositoryInvariantError({
          operation: 'assignConversation.insert',
          message: 'Assignment insert returned no row.',
        })
      }
      return yield* decodeAssignment(assignment)
    }),
  )
})

/** Closes an active assignment while retaining who performed the action. */
export const unassignConversation = Effect.fn(
  'MailRepository.unassignConversation',
)(function* (db: GardenDatabase, input: UnassignConversationInput) {
  return yield* inTransaction(db, 'unassignConversation', (tx) =>
    Effect.gen(function* () {
      if (input.unassignedBy._tag !== 'System') {
        yield* requireConversationAccess(tx, {
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          actor: input.unassignedBy,
          write: true,
          operation: 'unassignConversation.authorize',
        })
      }
      const actor = storedActionActor(input.unassignedBy)
      const rows = yield* databaseEffect('unassignConversation.update', () =>
        tx
          .update(mailConversationAssignment)
          .set({
            unassignedByType: actor.actorType,
            unassignedByMemberId: actor.memberId,
            unassignedByAgentId: actor.agentId,
            unassignedAt: new Date(),
          })
          .where(
            and(
              eq(mailConversationAssignment.workspaceId, input.workspaceId),
              eq(
                mailConversationAssignment.conversationId,
                input.conversationId,
              ),
              isNull(mailConversationAssignment.unassignedAt),
              assignmentActorPredicate(input.assignee),
            ),
          )
          .returning(),
      )
      const assignment = rows[0]
      if (assignment === undefined) {
        return yield* new MailRepositoryNotFoundError({
          entity: 'activeAssignment',
          id: input.conversationId,
          operation: 'unassignConversation',
          message: 'Active assignment does not exist.',
        })
      }
      return yield* decodeAssignment(assignment)
    }),
  )
})
