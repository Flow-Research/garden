import type { RootAgent } from './worker'
import type * as Worker from './worker'

declare global {
  namespace Cloudflare {
    interface Env {
      RootAgent: DurableObjectNamespace<RootAgent>
    }

    interface GlobalProps {
      mainModule: typeof Worker
      durableNamespaces: 'RootAgent'
    }
  }
}
