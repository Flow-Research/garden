import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import {
  BrainAuditRunner,
  BrainAuditRunError,
  makeBrainAuditRunnerLayer,
  type BrainAuditRunnerDependencies,
} from './brain-audit-runner'

const input = {
  itemId: 'item-42',
  text: 'Alice at Acme leads Project Atlas.',
  workspaceId: 'workspace-1',
}

/** Runs the public service method with a fresh lifecycle layer. */
const runAudit = (dependencies: BrainAuditRunnerDependencies) =>
  Effect.runPromise(
    Effect.flatMap(BrainAuditRunner, (runner) => runner.run(input)).pipe(
      Effect.provide(makeBrainAuditRunnerLayer(dependencies)),
    ),
  )

const makeDependencies = (
  overrides: Partial<BrainAuditRunnerDependencies> = {},
): BrainAuditRunnerDependencies => ({
  authorize: vi.fn().mockResolvedValue(undefined),
  resolveAgentId: vi.fn().mockResolvedValue('agent-1'),
  acquire: vi.fn().mockResolvedValue({
    runAudit: vi.fn().mockResolvedValue({ status: 'completed' }),
  }),
  release: vi.fn().mockResolvedValue(undefined),
  onStarted: vi.fn(),
  onCleanupFailure: vi.fn(),
  ...overrides,
})

describe('BrainAuditRunner', () => {
  it('runs one authorized facet turn and releases the facet', async () => {
    const dependencies = makeDependencies()

    await expect(runAudit(dependencies)).resolves.toEqual({
      agentId: 'agent-1',
      status: 'completed',
    })
    expect(dependencies.authorize).toHaveBeenCalledWith('workspace-1')
    expect(dependencies.release).toHaveBeenCalledWith('item-42')
  })

  it('releases the facet when the audit turn fails', async () => {
    const dependencies = makeDependencies({
      acquire: vi.fn().mockResolvedValue({
        runAudit: vi.fn().mockRejectedValue(new Error('model unavailable')),
      }),
    })

    await expect(runAudit(dependencies)).rejects.toBeInstanceOf(
      BrainAuditRunError,
    )
    expect(dependencies.release).toHaveBeenCalledWith('item-42')
  })

  it('reports cleanup failure without replacing a completed audit', async () => {
    const onCleanupFailure = vi.fn()
    const dependencies = makeDependencies({
      release: vi.fn().mockRejectedValue(new Error('facet busy')),
      onCleanupFailure,
    })

    await expect(runAudit(dependencies)).resolves.toMatchObject({
      status: 'completed',
    })
    expect(onCleanupFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        itemId: 'item-42',
        workspaceId: 'workspace-1',
        cause: expect.objectContaining({ message: 'facet busy' }),
      }),
    )
  })
})
