// @vitest-environment node
import { Result } from 'better-result'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DecideAnalysisSnapshot } from '@garden/agent-runtime/src/decide-analysis-types'
import type { DirectDecideToolExtra } from './direct-decide-mcp'

const startDecideAnalysis = vi.hoisted(() => vi.fn())

vi.mock('../decide-analysis/service', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  startDecideAnalysis,
}))

const { makeDecideAnalysisStarter } = await import('./decide-analysis-starter')

const RUN_ID = '2f9d1c66-9b5e-4c8e-9a51-0c7a3c3d7e10'
const SESSION_ID = 'sess_secret_123'

const snapshot = {
  runId: RUN_ID,
  status: 'queued',
  attempt: 1,
  providerSessionId: SESSION_ID,
} as DecideAnalysisSnapshot

const starter = makeDecideAnalysisStarter({
  env: {} as never,
  session: { organizationId: 'workspace', userId: 'user' },
})

const chatExtra = {
  _meta: {
    garden: { kind: 'chat', threadId: 'thread', toolCallId: 'call_1' },
  },
} as unknown as DirectDecideToolExtra

const textOf = (result: Awaited<ReturnType<typeof starter>>) =>
  (result?.content ?? [])
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')

describe('makeDecideAnalysisStarter', () => {
  beforeEach(() => startDecideAnalysis.mockReset())

  it.each(['started', 'already_running'] as const)(
    'tells the model where the %s answer appears without exposing IDs',
    async (kind) => {
      startDecideAnalysis.mockResolvedValue(Result.ok({ kind, snapshot }))

      const result = await starter({
        args: { question: 'What drove revenue?' },
        extra: chatExtra,
      })

      const text = textOf(result)
      expect(text).toContain('chat')
      expect(text).not.toContain(RUN_ID)
      expect(text).not.toContain(SESSION_ID)
      expect(text.toLowerCase()).not.toContain('run id')
      expect(result?.structuredContent).toEqual({
        status: 'queued',
        run_id: RUN_ID,
      })
    },
  )

  it('never forwards a model-supplied session_id', async () => {
    startDecideAnalysis.mockResolvedValue(
      Result.ok({ kind: 'started', snapshot }),
    )

    await starter({
      args: { question: 'Follow up', session_id: 'sess_from_model' },
      extra: chatExtra,
    })

    expect(JSON.stringify(startDecideAnalysis.mock.calls[0])).not.toContain(
      'sess_from_model',
    )
  })

  it('hands a Brain source to the service for Garden to read', async () => {
    startDecideAnalysis.mockResolvedValue(
      Result.ok({ kind: 'started', snapshot }),
    )

    await starter({
      args: {
        question: 'Which region grew?',
        source: { kind: 'brain_file', fileId: 'file_1' },
      },
      extra: chatExtra,
    })

    expect(startDecideAnalysis.mock.calls[0]?.[0]).toMatchObject({
      input: {
        kind: 'source',
        source: { kind: 'brain_file', fileId: 'file_1' },
      },
    })
  })

  it('starts an automation-owned run that resumes the automation', async () => {
    startDecideAnalysis.mockResolvedValue(
      Result.ok({ kind: 'started', snapshot }),
    )

    const result = await starter({
      args: { question: 'Which region grew fastest?' },
      extra: {
        _meta: {
          garden: {
            kind: 'automation_run',
            automationRunId: 'automation-run-1',
            toolCallId: 'call_1',
          },
        },
      } as unknown as DirectDecideToolExtra,
    })

    expect(startDecideAnalysis.mock.calls[0]?.[0]).toMatchObject({
      owner: { kind: 'automation_run', automationRunId: 'automation-run-1' },
      idempotencyKey: 'call_1',
    })
    const text = textOf(result)
    expect(text).toContain('automation')
    expect(text).not.toContain('chat')
    expect(text).not.toContain(RUN_ID)
    expect(result?.structuredContent).toEqual({
      status: 'queued',
      run_id: RUN_ID,
    })
  })

  it('leaves calls without trusted chat metadata to the direct path', async () => {
    const result = await starter({
      args: { question: 'Direct' },
      extra: {} as DirectDecideToolExtra,
    })

    expect(result).toBeNull()
    expect(startDecideAnalysis).not.toHaveBeenCalled()
  })
})
