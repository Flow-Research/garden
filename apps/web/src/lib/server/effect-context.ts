import { Context } from 'effect'
import type { AppRequestContext } from './context'

/** Request-owned TanStack context supplied to the Effect HTTP handler. */
export class AppRequest extends Context.Service<
  AppRequest,
  AppRequestContext
>()('@garden/web/AppRequest') {}
