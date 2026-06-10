import type { StorageAdapter } from '@garden/core/types/storage'
import type { Api } from '../platform/app-api'

export interface CoreProviderProps {
  children: React.ReactNode
  api: Api
  configureApi?: (
    baseUrl: string,
    options: {
      onUnauthorized?: () => void
    },
  ) => unknown
  apiBaseUrl?: string
  /** Storage adapter. Default: SSR-safe localStorage wrapper. */
  storage?: StorageAdapter
  /** Called after logout. */
  onLogout?: () => void
}
