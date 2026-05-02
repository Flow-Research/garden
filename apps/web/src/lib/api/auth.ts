import type { UpdateMeRequest, User, Workspace } from '@garden/core/types'
import { getApiTransport } from './state'

export interface BootstrapResponse {
  user: User
  workspaces: Workspace[]
}

export function logout(): Promise<void> {
  return getApiTransport().request('/api/auth/sign-out', { method: 'POST' })
}

export function bootstrap(): Promise<BootstrapResponse> {
  return getApiTransport().request('/api/bootstrap')
}

export function updateMe(data: UpdateMeRequest): Promise<User> {
  return getApiTransport().request('/api/me', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}
