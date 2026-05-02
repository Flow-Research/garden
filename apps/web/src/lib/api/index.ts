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
export * from './runtimes'
export * from './files'
export * from './projects'
export * from './pins'
export * from './connections'
export * from './chat-threads'
export * from './documents'
export type { AgentChatSession, ChatThreadRow } from '@garden/core/types'
export type { RiskClass } from '@garden/connector-sdk'

import * as auth from './auth'
import * as issues from './issues'
import * as workspace from './workspace'
import * as skills from './skills'
import * as inbox from './inbox'
import * as runtimes from './runtimes'
import * as files from './files'
import * as projects from './projects'
import * as pins from './pins'
import * as connections from './connections'
import * as chatThreads from './chat-threads'
import * as documents from './documents'
import { getBaseUrl, setWorkspaceId } from './state'

export type { BootstrapResponse } from './auth'
export type {
  ConnectionAction,
  ConnectionActivityItem,
  ConnectionActivityResponse,
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
  ...runtimes,
  ...files,
  ...projects,
  ...pins,
  ...connections,
  ...chatThreads,
  ...documents,
}

export type Api = typeof api
