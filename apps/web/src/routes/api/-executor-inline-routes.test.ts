// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const routeSource = (relativePath: string) =>
  readFile(new URL(relativePath, import.meta.url), 'utf8')

describe('in-process Executor API route boundaries', () => {
  it('loads the connection catalog through the in-process SDK', async () => {
    const source = await routeSource('./connections.ts')

    expect(source).toContain('loadExecutorCatalog(identity)')
    expect(source).toContain("from '@/lib/server/executor-runtime'")
    expect(source).not.toContain('executor-connectors-service')
    expect(source).not.toContain('EXECUTOR_CONNECTORS')
  })

  it('keeps registry, preview, and install on Garden API routes', async () => {
    const [install, preview, registry, client] = await Promise.all([
      routeSource('./executor/install.ts'),
      routeSource('./executor/preview.ts'),
      routeSource('./executor/registry.ts'),
      routeSource('../../lib/api/executor.ts'),
    ])

    expect(install).toContain('executorProgram(identity')
    expect(client).toContain('/api/executor/install')
    expect(client).toContain('/api/executor/preview')
    expect(client).toContain('/api/executor/registry')
    for (const source of [install, preview, registry, client]) {
      expect(source).not.toContain('/api/harnessy')
      expect(source).not.toContain('executor-connectors-service')
      expect(source).not.toContain('@flowresearch/harnessy')
    }
  })

  it('keeps OAuth start and callback inside Garden request-scoped Effect', async () => {
    const [start, callback] = await Promise.all([
      routeSource('./executor/oauth/start.ts'),
      routeSource('./oauth/callback.ts'),
    ])

    for (const source of [start, callback]) {
      expect(source).toContain("from '@executor-js/sdk/core'")
      expect(source).toContain("from '@/lib/server/executor-runtime'")
      expect(source).not.toContain('executor-connectors-service')
      expect(source).not.toContain('EXECUTOR_CONNECTORS')
      expect(source).not.toContain("from '@/lib/server/harnessy-runtime'")
      expect(source).not.toContain("from '@flowresearch/executor/shared'")
    }
    expect(start).toContain('executorProgram(identity')
    expect(callback).toContain('executor.oauth.complete')
    expect(callback).toContain('executor.oauth.cancel')
  })

  it('runs connection create, refresh, and removal through the same runtime', async () => {
    const source = await routeSource('./connections/$connectorId.ts')

    expect(source).toContain("from '@executor-js/sdk/core'")
    expect(source).toContain("from '@/lib/server/executor-runtime'")
    expect(source).toContain('runExecutor(')
    expect(source).toContain('executor.connections.refresh')
    expect(source).toContain('executor.connections.remove')
    expect(source).not.toContain('executor-connectors-service')
    expect(source).not.toContain('EXECUTOR_CONNECTORS')
    expect(source).not.toContain("from '@/lib/server/harnessy-runtime'")
    expect(source).not.toContain("from '@flowresearch/executor/shared'")
  })
})
