// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { Subject, Tenant, createExecutor } from '@executor-js/sdk/core'

import { makeExecutorPlugins } from './executor-engine/plugins'

describe('direct Executor runtime compatibility', () => {
  it('acquires, reads, and closes v1.5.40 on Garden Effect beta102', async () => {
    const integrations = await Effect.runPromise(
      Effect.acquireUseRelease(
        createExecutor({
          tenant: Tenant.make('garden-runtime-test'),
          subject: Subject.make('garden-runtime-actor'),
          plugins: makeExecutorPlugins('test-secret-key-at-least-32-characters'),
          onElicitation: () => Effect.succeed({ action: 'decline' as const }),
        }),
        (executor) => executor.integrations.list(),
        (executor) => executor.close().pipe(Effect.ignore),
      ),
    )

    expect(integrations).toEqual([
      expect.objectContaining({
        slug: 'executor',
        kind: 'built-in',
      }),
    ])
  })
})
