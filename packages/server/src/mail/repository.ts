import type { GardenDatabase } from '@garden/db'
import { Layer } from 'effect'
import {
  assignConversation,
  unassignConversation,
  updateConversationState,
} from './repository/collaboration.ts'
import { MailRepository } from './repository/contracts.ts'
import { createDraft, saveDraft } from './repository/drafts.ts'
import { ingestInbound } from './repository/ingest.ts'
import {
  getConversation,
  listConversations,
  listMailboxes,
  resolveLocalAddress,
} from './repository/queries.ts'

export * from './repository/contracts.ts'

/** Binds one request-owned Garden database client to the Effect repository service. */
export const makeMailRepositoryLayer = (
  db: GardenDatabase,
): Layer.Layer<MailRepository> =>
  Layer.succeed(
    MailRepository,
    MailRepository.of({
      listMailboxes: (input) => listMailboxes(db, input),
      listConversations: (input) => listConversations(db, input),
      getConversation: (input) => getConversation(db, input),
      resolveLocalAddress: (input) => resolveLocalAddress(db, input),
      ingestInbound: (input) => ingestInbound(db, input),
      createDraft: (input) => createDraft(db, input),
      saveDraft: (input) => saveDraft(db, input),
      updateConversationState: (input) => updateConversationState(db, input),
      assignConversation: (input) => assignConversation(db, input),
      unassignConversation: (input) => unassignConversation(db, input),
    }),
  )
