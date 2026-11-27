import {
  badRequest,
  json,
  notFound,
  serviceUnavailable,
} from '@/lib/server/control-plane'
import { createGardenLogger, errorFields } from '@garden/observability/logger'

const logger = createGardenLogger({
  service: 'garden-staging',
  component: 'service-error-response',
})

/**
 * Maps a service error's `code` to an HTTP response in one place. Infrastructure
 * failures become 5xx (so request logging alerts on them) with a generic
 * message; `*_not_found` becomes 404; anything else is the caller's fault (400).
 */
export function serviceErrorResponse(error: { code: string; message: string }) {
  if (error.code === 'db_error') {
    return serviceUnavailable('The database is unavailable. Try again shortly.')
  }
  if (error.code === 'runtime_error') {
    logger.error('service.runtime_error', errorFields(error))
    return json({ error: 'The service could not complete the request.' }, 502)
  }
  if (error.code.endsWith('_not_found')) return notFound(error.message)
  return badRequest(error.message)
}
