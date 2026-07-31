import { Context } from 'effect'
import type { AppRequestContext } from './context'

/** Request-owned TanStack context supplied to the Effect HTTP handler. */
export class AppRequest extends Context.Service<AppRequest, AppRequestContext>()(
  '@garden/web/AppRequest',
) {}

export function appRequestContext(context: AppRequestContext) {
  return Context.make(AppRequest, context)
}
