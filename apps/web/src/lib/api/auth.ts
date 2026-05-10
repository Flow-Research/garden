import type { UpdateMeRequest, User } from '@garden/core/types'
import { getApiTransport } from './state'

export function logout(): Promise<void> {
  return getApiTransport().request('/api/auth/sign-out', { method: 'POST' })
}

export function updateMe(data: UpdateMeRequest): Promise<User> {
  return getApiTransport().request('/api/me', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}
