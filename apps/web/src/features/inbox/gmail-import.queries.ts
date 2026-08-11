import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { PersonalMailSyncState } from '@garden/core/mail'
import { requireAppRequestContext } from '@/lib/server/context'
import {
  getPersonalGmailImportStates,
  startPersonalGmailImport,
} from '@/lib/server/mail-sync-api'

const workspaceInput = z.object({ workspaceId: z.uuid() })
const startInput = workspaceInput.extend({
  connectionAddress: z.string().trim().min(1),
})

const getImportStates = createServerFn({ method: 'GET' })
  .inputValidator(workspaceInput)
  .handler(({ context, data }) =>
    getPersonalGmailImportStates(
      requireAppRequestContext(context),
      data.workspaceId,
    ),
  )

const startImport = createServerFn({ method: 'POST' })
  .inputValidator(startInput)
  .handler(({ context, data }) =>
    startPersonalGmailImport(requireAppRequestContext(context), data),
  )

export const gmailImportKeys = {
  all: (workspaceId: string) =>
    ['garden-mail', workspaceId, 'gmail-import'] as const,
  states: (workspaceId: string) =>
    [...gmailImportKeys.all(workspaceId), 'states'] as const,
}

const activeSync = (states: ReadonlyArray<PersonalMailSyncState>): boolean =>
  states.some(
    (state) =>
      state.latestRun?.status === 'queued' ||
      state.latestRun?.status === 'enumerating' ||
      state.latestRun?.status === 'importing',
  )

/**
 * Polls only while the durable ledger is active and stops for every terminal
 * state. Two seconds matches Garden's existing Workflow-run observer policy;
 * realtime delivery can later invalidate this same key without changing UI.
 */
export function gmailImportStatesOptions(workspaceId: string) {
  return queryOptions({
    queryKey: gmailImportKeys.states(workspaceId),
    queryFn: (): Promise<ReadonlyArray<PersonalMailSyncState>> =>
      getImportStates({ data: { workspaceId } }),
    staleTime: 2_000,
    refetchInterval: (query) =>
      query.state.data !== undefined && activeSync(query.state.data)
        ? 2_000
        : false,
  })
}

/** Starts or recovers the deterministic Workflow for one exact connection. */
export async function startGmailImport(input: {
  data: { workspaceId: string; connectionAddress: string }
}) {
  return await startImport(input)
}
