import { createStart } from '@tanstack/react-start'
import { apiRequestLoggingMiddleware } from '@/lib/server/api-logging'

export const startInstance = createStart(() => ({
  requestMiddleware: [apiRequestLoggingMiddleware],
}))
