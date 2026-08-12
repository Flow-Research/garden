import { MailRepositoryPersistenceError } from '@garden/server/mail'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  mailImportCheckpointOutcome,
  retryMailImportPersistenceAtWorkflowBoundary,
} from './mail-import-workflow-boundary'

describe('Gmail import Workflow persistence boundary', () => {
  it('rejects transient database failures so Cloudflare retries the step', async () => {
    const failure = new MailRepositoryPersistenceError({
      reason: 'query',
      operation: 'MailSync.claim',
      message: 'Garden Mail persistence operation failed.',
    })

    await expect(
      Effect.runPromise(
        Effect.fail(failure).pipe(
          retryMailImportPersistenceAtWorkflowBoundary,
          mailImportCheckpointOutcome,
        ),
      ),
    ).rejects.toThrow('Garden Mail persistence operation failed.')
  })

  it('keeps invalid persisted data terminal instead of retrying it', async () => {
    const failure = new MailRepositoryPersistenceError({
      reason: 'decode',
      operation: 'MailSync.decode',
      message: 'Garden Mail returned an invalid persisted value.',
    })

    const outcome = await Effect.runPromise(
      Effect.fail(failure).pipe(
        retryMailImportPersistenceAtWorkflowBoundary,
        mailImportCheckpointOutcome,
      ),
    )

    expect(outcome).toEqual({
      _tag: 'Failure',
      message: 'Garden Mail returned an invalid persisted value.',
    })
  })
})
