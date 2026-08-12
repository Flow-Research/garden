export {
  CLOUDFLARE_MAIL_PROVIDER,
  CloudflareMailBinding,
  cloudflareMailTransportLayer,
  makeCloudflareMailTransportLayer,
  normalizeCloudflareInbound,
} from './cloudflare.ts'
export type { CloudflareMailBindingService } from './cloudflare.ts'
export {
  InboundMailHeader,
  MailAttachment,
  MailSendReceipt,
  MailTransportAddress,
  MailTransportRoute,
  NormalizedInboundMail,
  OutboundMail,
  RoutedOutboundMail,
} from './model.ts'
export {
  MailInboundReadError,
  MailTransport,
  MailTransportSendError,
  TestMailTransport,
  testMailTransportLayer,
} from './transport.ts'
export type {
  MailTransportService,
  TestMailTransportService,
} from './transport.ts'
export {
  MailMimeParseError,
  MailMimeValidationError,
  ParsedMimeAddress,
  ParsedMimeAttachment,
  ParsedMimeHeader,
  ParsedMimeMessage,
  ParsedMimeRecipient,
  parseNormalizedMime,
} from './mime.ts'
export {
  MailObject,
  MailObjectDeleteError,
  MailObjectNotFoundError,
  MailObjectReadError,
  MailObjectStore,
  MailObjectWriteError,
  StoredMailObject,
  TestMailObjectStore,
  makeR2MailObjectStoreLayer,
  testMailObjectStoreLayer,
} from './object-store.ts'
export type {
  MailObjectStoreService,
  TestMailObjectStoreService,
} from './object-store.ts'
export {
  MailContentHashError,
  attachmentStorageKey,
  inboundProviderMessageId,
  mailThreadKey,
  normalizedMailSubject,
  rawMailStorageKey,
  sha256,
} from './content-addressing.ts'
export {
  DraftAttachmentDescriptor,
  DraftAttachmentPersistenceError,
  DraftAttachmentUploadInput,
  DraftAttachmentValidationError,
  MAX_OUTBOUND_ATTACHMENT_BYTES,
  authorizeDraftAttachmentUpload,
  deleteUnreferencedDraftAttachment,
  storeDraftAttachment,
} from './draft-attachment.ts'
export { sanitizeAuthoredMailHtml } from './html.ts'
export {
  DraftCommand,
  DraftTransition,
  InvalidDraftTransitionError,
  decideDraftTransition,
} from './draft-state.ts'
export {
  DraftDeliveryAuthorization,
  MailDraftApplication,
  mailDraftApplicationLayer,
} from './draft-application.ts'
export type {
  MailDraftApplicationError,
  MailDraftApplicationService,
  MemberDraftCommandInput,
} from './draft-application.ts'
export * from './domain-provider.ts'
export {
  CloudflareDomainProviderConfig,
  cloudflareDomainProviderConfigLayer,
  cloudflareDomainProviderLayer,
} from './cloudflare-domain-provider.ts'
export type { CloudflareDomainProviderConfigService } from './cloudflare-domain-provider.ts'
export * from './provisioning.ts'
export {
  MailIngress,
  ingestNormalizedMail,
  mailIngressLayer,
} from './ingress.ts'
export type { MailIngressError, MailIngressService } from './ingress.ts'
export {
  MailRepository,
  MailRepositoryAccessDeniedError,
  MailRepositoryInvariantError,
  MailRepositoryNotFoundError,
  MailRepositoryPersistenceError,
  MailDraftRevisionConflictError,
  makeMailRepositoryLayer,
} from './repository.ts'
export type {
  AccessibleMailbox,
  AssignmentSnapshot,
  AttachmentContentRef,
  ConversationActorState,
  ConversationDetail,
  ConversationPage,
  ConversationSummary,
  DraftSnapshot,
  MailRepositoryError,
  MailRepositoryService,
  RepositoryAttachment,
  RepositoryMessage,
  RepositoryRecipient,
} from './repository.ts'
export {
  MailDelivery,
  MailDeliveryContentError,
  MailDeliveryResult,
  MailDeliverySubmission,
  mailDeliveryLayer,
} from './delivery.ts'
export type { MailDeliveryError, MailDeliveryService } from './delivery.ts'
export { DeliveryPreparation, PreparedDelivery } from './repository.ts'
export {
  AgentCreateDraftInput,
  AgentDraftDeliveryRequestOutcome,
  AgentListConversationsInput,
  AgentReadConversationInput,
  AgentRequestDraftDeliveryInput,
  AgentSaveDraftInput,
  MailAgentApplication,
  MailAgentDeliveryDispatchError,
  MailAgentDeliveryDispatcher,
  MailAgentDraftUnavailableError,
  MailAgentMailboxReadOnlyError,
  MailAgentPrincipal,
  makeMailAgentApplicationLayer,
} from './agent-application.ts'
export type {
  MailAgentApplicationError,
  MailAgentApplicationService,
  MailAgentDeliveryDispatcherService,
} from './agent-application.ts'
export {
  GmailApiError,
  GmailApiOperation,
  GmailClient,
  GmailHistoryRecord,
  GmailHistoryType,
  GmailListHistoryInput,
  GmailListHistoryResponse,
  GmailListMessagesInput,
  GmailListMessagesResponse,
  GmailModifyMessageInput,
  GmailModifyMessageResponse,
  GmailModifyThreadInput,
  GmailModifyThreadResponse,
  GmailMessageReference,
  GmailProfile,
  GmailRawMessage,
  GmailSendMessageInput,
  GmailSendMessageResponse,
  makeGmailClient,
  makeGmailClientLayer,
} from './gmail-client.ts'
export type { GmailClientService } from './gmail-client.ts'
export {
  GmailOutboundAccount,
  GmailOutboundGateway,
  GmailOutboundGatewayError,
  gmailRawBase64Url,
  gmailRawMessage,
  makeRoutedMailTransportLayer,
} from './gmail-transport.ts'
export type { GmailOutboundGatewayService } from './gmail-transport.ts'
export {
  GmailImport,
  GmailImportContentError,
  ImportGmailMessageInput,
  gmailImportLayer,
  importGmailRawMessage,
} from './gmail-import.ts'
export type {
  GmailImportMessageError,
  GmailImportService,
} from './gmail-import.ts'
