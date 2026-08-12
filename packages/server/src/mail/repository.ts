import type { GardenDatabase } from '@garden/db'
import { Layer } from 'effect'
import {
  assignConversation,
  unassignConversation,
  updateConversationState,
} from './repository/collaboration.ts'
import {
  getAttachmentContentRef,
  getRawMessageContentRef,
} from './repository/content.ts'
import { MailRepository } from './repository/contracts.ts'
import {
  createDraft,
  resolveDraftSender,
  saveDraft,
} from './repository/drafts.ts'
import { transitionDraft } from './repository/transitions.ts'
import { ingestInbound } from './repository/ingest.ts'
import { ingestImported } from './repository/import.ts'
import {
  completeDraftDelivery,
  failDraftDelivery,
  recordDeliveryOutcome,
} from './repository/outbound-finalize.ts'
import { prepareDraftDelivery } from './repository/outbound.ts'
import {
  getConversation,
  getDraft,
  listConversationPage,
  listConversations,
  listMailboxes,
  resolveLocalAddress,
} from './repository/queries.ts'
import {
  claimPendingMailSyncBatch,
  cancelMailSyncRun,
  completeMailSyncRun,
  failMailSyncRun,
  finalizeMailSyncEnumeration,
  listPersonalMailSyncStates,
  persistMailSyncPage,
  resolveMailSyncAccount,
  settleMailSyncItem,
  startMailSyncRun,
} from './repository/sync.ts'

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
      listConversationPage: (input) => listConversationPage(db, input),
      getConversation: (input) => getConversation(db, input),
      getDraft: (input) => getDraft(db, input),
      resolveDraftSender: (input) => resolveDraftSender(db, input),
      getRawMessageContentRef: (input) => getRawMessageContentRef(db, input),
      getAttachmentContentRef: (input) => getAttachmentContentRef(db, input),
      resolveLocalAddress: (input) => resolveLocalAddress(db, input),
      ingestInbound: (input) => ingestInbound(db, input),
      ingestImported: (input) => ingestImported(db, input),
      resolveMailSyncAccount: (input) => resolveMailSyncAccount(db, input),
      listPersonalMailSyncStates: (input) =>
        listPersonalMailSyncStates(db, input),
      startMailSyncRun: (input) => startMailSyncRun(db, input),
      persistMailSyncPage: (input) => persistMailSyncPage(db, input),
      finalizeMailSyncEnumeration: (input) =>
        finalizeMailSyncEnumeration(db, input),
      claimPendingMailSyncBatch: (input) =>
        claimPendingMailSyncBatch(db, input),
      settleMailSyncItem: (input) => settleMailSyncItem(db, input),
      completeMailSyncRun: (input) => completeMailSyncRun(db, input),
      failMailSyncRun: (input) => failMailSyncRun(db, input),
      cancelMailSyncRun: (input) => cancelMailSyncRun(db, input),
      createDraft: (input) => createDraft(db, input),
      saveDraft: (input) => saveDraft(db, input),
      transitionDraft: (input) => transitionDraft(db, input),
      prepareDraftDelivery: (input) => prepareDraftDelivery(db, input),
      completeDraftDelivery: (input) => completeDraftDelivery(db, input),
      failDraftDelivery: (input) => failDraftDelivery(db, input),
      recordDeliveryOutcome: (input) => recordDeliveryOutcome(db, input),
      updateConversationState: (input) => updateConversationState(db, input),
      assignConversation: (input) => assignConversation(db, input),
      unassignConversation: (input) => unassignConversation(db, input),
    }),
  )
