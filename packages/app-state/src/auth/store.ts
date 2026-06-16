import { create } from 'zustand'
import type { User } from '@garden/core/types'
import type { Api } from '../platform/app-api'

export interface AuthStoreOptions {
  api: Api
  onLogout?: () => void
}

export interface AuthState {
  user: User | null

  logout: () => Promise<void>
  setUser: (user: User | null) => void
}

let authApi: Pick<Api, 'logout' | 'setWorkspaceHeader'> | null = null
let onLogoutCallback: (() => void) | undefined

function getAuthApi() {
  if (!authApi) throw new Error('Auth store not configured')
  return authApi
}

export function configureAuthStore(options: AuthStoreOptions) {
  authApi = options.api
  onLogoutCallback = options.onLogout
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,

  logout: async () => {
    const api = getAuthApi()
    await api.logout()
    api.setWorkspaceHeader(null)
    onLogoutCallback?.()
    set({ user: null })
  },

  setUser: (user) => {
    set({ user })
  },
}))
