import { createAuthClient } from 'better-auth/react'
import {
  genericOAuthClient,
  organizationClient,
} from 'better-auth/client/plugins'

const baseURL =
  typeof window === 'undefined'
    ? 'http://localhost:3000'
    : window.location.origin

export const authClient = createAuthClient({
  baseURL,
  plugins: [organizationClient(), genericOAuthClient()],
})
