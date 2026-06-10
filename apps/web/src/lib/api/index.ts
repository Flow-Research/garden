export { ApiError } from './errors'
export { ApiTransport } from './transport'
export type { ApiTransportOptions, ApiRequestInit } from './transport'
export {
  configureApi,
  getApiTransport,
  getBaseUrl,
  setWorkspaceId,
} from './state'
export * from './auth'
export * from './issues'
export * from './workspace'
export * from './skills'
export * from './inbox'
export * from './files'
export * from './projects'
export * from './connections'
export * from './chat-threads'
export * from './documents'
export * from './automations'
export type { AgentChatSession, ChatThreadRow } from '@garden/core/types'
export type { RiskClass } from '@garden/connectors/capabilities'

import * as auth from './auth'
import * as issues from './issues'
import * as workspace from './workspace'
import * as skills from './skills'
import * as inbox from './inbox'
import * as files from './files'
import * as projects from './projects'
import * as connections from './connections'
import * as chatThreads from './chat-threads'
import * as documents from './documents'
import * as automations from './automations'
import { getBaseUrl, setWorkspaceId } from './state'

export type {
  ConnectionAction,
  ConnectionActivityItem,
  ConnectionActivityResponse,
  ConnectorCallbackEventItem,
  ConnectorCallbackEventResponse,
  ConnectionItem,
  ConnectionsSnapshot,
  ConnectionTool,
  ConnectorStatus,
  PermissionTrustLevel,
} from './connections'
export type { DocumentVersionItem, ThreadDocumentsResponse } from './documents'

export const api = {
  getBaseUrl,
  setWorkspaceId,
  ...auth,
  ...issues,
  ...workspace,
  ...skills,
  ...inbox,
  ...files,
  ...projects,
  ...connections,
  ...chatThreads,
  ...documents,
  ...automations,
}

export type Api = typeof api
