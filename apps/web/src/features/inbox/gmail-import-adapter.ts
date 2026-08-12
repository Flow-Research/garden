import { Option } from 'effect'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useState } from 'react'
import {
  connectIntegration,
  executorOAuthStartUrl,
  searchRegistry,
} from '@/lib/api/executor'
import { connectionListOptions, workspaceKeys } from '@/lib/workspace/queries'
import { mailInboxOptions, mailKeys } from './mail.queries'
import {
  cancelGmailImport,
  gmailImportKeys,
  gmailImportStatesOptions,
  startGmailImport,
} from './gmail-import.queries'
import type {
  GmailImportAccountView,
  GmailImportController,
  GmailImportState,
} from './gmail-import-controller'

const GOOGLE_GMAIL_INTEGRATION = 'google_gmail'
const GOOGLE_GMAIL_PROVIDER = 'executor:google_gmail'

/** Stable UTC completion copy avoids hydration and locale-timezone drift. */
const finishedAtLabel = (value: string | null): string => {
  if (value === null) return 'Import complete'
  return `Finished ${new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value))} UTC`
}

/** Maps the exact selected ledger row into the presentational state union. */
const importState = (input: {
  checking: boolean
  authorizing: boolean
  starting: boolean
  cancelling: boolean
  hasAccounts: boolean
  run: {
    status: string
    processedMessages: number
    totalMessages: number | null
    importedMessages: number
    duplicateMessages: number
    error: string | null
    completedAt: string | null
  } | null
}): GmailImportState => {
  if (input.checking) return { status: 'checking' }
  if (input.authorizing) return { status: 'authorizing' }
  if (!input.hasAccounts) return { status: 'disconnected' }
  if (input.starting) return { status: 'scanning' }
  const run = input.run
  if (run === null) return { status: 'connected' }
  if (input.cancelling) {
    return {
      status: 'cancelling',
      processed: run.processedMessages,
      total: run.totalMessages,
    }
  }
  if (run.status === 'queued' || run.status === 'enumerating') {
    return { status: 'scanning' }
  }
  if (run.status === 'importing') {
    return {
      status: 'syncing',
      processed: run.processedMessages,
      total: run.totalMessages ?? 0,
    }
  }
  if (run.status === 'completed') {
    return {
      status: 'complete',
      imported: run.importedMessages,
      skipped: run.duplicateMessages,
      finishedAtLabel: finishedAtLabel(run.completedAt),
    }
  }
  if (run.status === 'failed') {
    return {
      status: 'failed',
      processed: run.processedMessages,
      total: run.totalMessages,
      message: run.error ?? 'Gmail import failed before it could complete.',
    }
  }
  if (run.status === 'cancelled' && run.totalMessages !== null) {
    return {
      status: 'paused',
      processed: run.processedMessages,
      total: run.totalMessages,
    }
  }
  return { status: 'connected' }
}

/**
 * Authenticated adapter for the Inbox Gmail control. Executor remains the
 * connection authority; Postgres remains the progress authority. No React
 * effect coordinates them, so polling can later be swapped for cache events.
 */
export function useGmailImportController(input: {
  workspaceId: string
}): GmailImportController {
  const queryClient = useQueryClient()
  const connectionsQuery = useQuery(connectionListOptions(input.workspaceId))
  const statesQuery = useQuery(gmailImportStatesOptions(input.workspaceId))
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null)

  const integration = connectionsQuery.data?.integrations.find(
    (candidate) => String(candidate.slug) === GOOGLE_GMAIL_INTEGRATION,
  )
  const iconUrl = integration ? Option.getOrNull(integration.icon) : null
  const connectionModels = (integration?.connections ?? []).filter(
    (connection) => connection.owner === 'user',
  )
  const accounts: GmailImportAccountView[] = connectionModels.map(
    (connection) => ({
      connectionAddress: String(connection.address),
      identityLabel: Option.getOrElse(
        connection.identityLabel,
        () => connection.name,
      ),
      iconUrl,
      importMode: 'read_only',
    }),
  )
  const effectiveAddress =
    selectedAddress ??
    (connectionModels.length === 1
      ? String(connectionModels[0]?.address)
      : null)
  const selectedConnection = connectionModels.find(
    (connection) => String(connection.address) === effectiveAddress,
  )
  const selectedSyncState = statesQuery.data?.find(
    (candidate) =>
      candidate.account?.executorConnectionName === selectedConnection?.name,
  )
  const active =
    selectedSyncState?.latestRun?.status === 'queued' ||
    selectedSyncState?.latestRun?.status === 'enumerating' ||
    selectedSyncState?.latestRun?.status === 'importing'

  // A second observer on the shared key makes imported rows appear progressively.
  useInfiniteQuery({
    ...mailInboxOptions(input.workspaceId),
    enabled: active,
    refetchInterval: active ? 2_000 : false,
  })

  const connectMutation = useMutation({
    mutationFn: async () => {
      const registry = await searchRegistry({ q: 'Gmail', limit: 10 })
      const entry = registry.entries.find(
        (candidate) => String(candidate.providerId) === GOOGLE_GMAIL_PROVIDER,
      )
      if (entry === undefined) {
        throw new Error(
          'Google Gmail is not available in the connector catalog.',
        )
      }
      return await connectIntegration({ entry, source: 'openapi' })
    },
    onSuccess: (result) => {
      if (
        result.kind === 'oauth_ready' ||
        result.kind === 'authorization_redirect'
      ) {
        window.location.assign(executorOAuthStartUrl(result.slug, 'user'))
        return
      }
      void queryClient.invalidateQueries({
        queryKey: workspaceKeys.connections(input.workspaceId),
      })
    },
  })

  const startMutation = useMutation({
    mutationFn: (connectionAddress: string) =>
      startGmailImport({
        data: { workspaceId: input.workspaceId, connectionAddress },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: gmailImportKeys.all(input.workspaceId),
      })
      void queryClient.invalidateQueries({
        queryKey: mailKeys.all(input.workspaceId),
      })
    },
  })

  const cancelMutation = useMutation({
    mutationFn: (runId: string) =>
      cancelGmailImport({
        data: { workspaceId: input.workspaceId, runId },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: gmailImportKeys.all(input.workspaceId),
      })
    },
  })

  const startSelectedImport = () => {
    if (effectiveAddress !== null) startMutation.mutate(effectiveAddress)
  }

  return {
    state: importState({
      checking: connectionsQuery.isLoading || statesQuery.isLoading,
      authorizing: connectMutation.isPending,
      starting: startMutation.isPending,
      cancelling: cancelMutation.isPending,
      hasAccounts: accounts.length > 0,
      run: selectedSyncState?.latestRun ?? null,
    }),
    accounts,
    selectedConnectionAddress: effectiveAddress,
    gmailIconUrl: iconUrl,
    actions: {
      connect: () => connectMutation.mutate(),
      selectAccount: setSelectedAddress,
      startImport: startSelectedImport,
      retryImport: startSelectedImport,
      cancelImport: () => {
        const runId = selectedSyncState?.latestRun?.id
        if (runId !== undefined) cancelMutation.mutate(runId)
      },
      resumeImport: startSelectedImport,
    },
  }
}
