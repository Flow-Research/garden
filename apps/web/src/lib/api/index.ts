export { ApiError } from './errors'
export { ApiTransport } from './transport'
export type { ApiTransportOptions, ApiRequestInit } from './transport'
export {
  configureApi,
  getApiTransport,
  isApiConfigured,
  getBaseUrl,
  setWorkspaceHeader,
  setWorkspaceId,
} from './state'
export * from './auth'
export * from './issues'
export * from './workspace'
export * from './skills'
export * from './inbox'
export * from './gmail'
export * from './files'
export * from './projects'
export * from './connections'
export * from './chat-threads'
export * from './documents'
export * from './automations'
export * from './teams'
export type { AgentChatSession, ChatThreadRow } from '@garden/core/types'
export type { RiskClass } from '@garden/connectors/capabilities'

import * as auth from './auth'
import * as issues from './issues'
import * as workspace from './workspace'
import * as skills from './skills'
import * as inbox from './inbox'
import * as gmail from './gmail'
import * as files from './files'
import * as projects from './projects'
import * as connections from './connections'
import * as chatThreads from './chat-threads'
import * as documents from './documents'
import * as automations from './automations'
import * as teams from './teams'
import { getBaseUrl, setWorkspaceHeader, setWorkspaceId } from './state'

export type { IntegrationAction } from './connections'
export type { DocumentVersionItem, ThreadDocumentsResponse } from './documents'

export const api = {
  getBaseUrl,
  setWorkspaceHeader,
  setWorkspaceId,
  ...auth,
  ...issues,
  ...workspace,
  ...skills,
  ...inbox,
  ...gmail,
  ...files,
  ...projects,
  ...connections,
  ...chatThreads,
  ...documents,
  ...automations,
  ...teams,
}

export type Api = typeof api
