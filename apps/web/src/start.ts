import { createCsrfMiddleware, createStart } from '@tanstack/react-start'
import { apiRequestLoggingMiddleware } from '@/lib/server/api-logging'

export const serverFunctionCsrf = createCsrfMiddleware({
  filter: (context) => context.handlerType === 'serverFn',
})

export const startInstance = createStart(() => ({
  requestMiddleware: [serverFunctionCsrf, apiRequestLoggingMiddleware],
}))
