/**
 * The chat card for a background Decide run. The analyze tool call returns as
 * soon as the run starts and the turn ends there, so this card is what the
 * user watches: a fixed opening line, a live status with Decide's latest
 * progress note, elapsed time and Cancel, then the outcome and the generated
 * files. The answer itself arrives later as the next assistant message.
 */
import { useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  CircleSlash,
  ExternalLink,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'
import { Spinner } from '@garden/ui/components/ui/spinner'
import { MessageResponse } from '@/components/ai-elements/message'
import { Shimmer } from '@/components/ai-elements/shimmer'
import {
  cancelChatDecideAnalysis,
  type ChatDecideAnalysisFile,
} from '@/lib/api/chat-threads'
import { decideAnalysisOptions } from '../queries'
import {
  decideAnalysisCardView,
  decideFileKind,
  formatElapsed,
  type DecideFileKind,
} from './chat-message-model'

/**
 * Shown under every Decide start instead of model prose. The start turn ends
 * in code right after the tool call, so the model writes nothing; a fixed
 * line is deterministic, costs no tokens, and survives a reload.
 */
export const DECIDE_ANALYSIS_OPENING_LINE =
  "I'm running this through Decide. The answer will appear here shortly."

const subscribeToSeconds = (onTick: () => void) => {
  const timer = setInterval(onTick, 1000)
  return () => clearInterval(timer)
}

/** Wall clock in whole seconds, ticking once a second while subscribed. */
function useNowSeconds() {
  return useSyncExternalStore(
    subscribeToSeconds,
    () => Math.floor(Date.now() / 1000),
    () => 0,
  )
}

function ElapsedTime({ since }: { since: string }) {
  const nowSeconds = useNowSeconds()
  return (
    <span className="tabular-nums text-muted-foreground">
      {formatElapsed(nowSeconds * 1000 - Date.parse(since))}
    </span>
  )
}

const FILE_ICONS: Record<DecideFileKind, typeof FileIcon> = {
  image: FileImage,
  spreadsheet: FileSpreadsheet,
  document: FileText,
  file: FileIcon,
}

/**
 * One generated file. Decide hosts outputs on its own origin, where the
 * `download` attribute is ignored, so the action opens the file in a new tab
 * instead of navigating Garden away. Images show an inline preview.
 */
function DecideFileCard({ file }: { file: ChatDecideAnalysisFile }) {
  const kind = decideFileKind(file.name)
  const Icon = FILE_ICONS[kind]
  const extension = file.name.includes('.')
    ? (file.name.split('.').at(-1) ?? '').toUpperCase()
    : 'FILE'
  return (
    <a
      href={file.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex w-full flex-col overflow-hidden rounded-lg border border-border bg-muted font-sans transition-colors hover:bg-accent"
    >
      {kind === 'image' ? (
        <img
          src={file.url}
          alt={file.name}
          loading="lazy"
          className="max-h-72 w-full border-b border-border bg-background object-contain"
        />
      ) : null}
      <span className="flex min-w-0 items-center gap-3 px-4 py-3">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">
            {file.name}
          </span>
          <span className="block text-xs text-info">{extension}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground">
          Open
          <ExternalLink className="size-3.5" />
        </span>
      </span>
    </a>
  )
}

const STATUS_ICONS = {
  completed: Check,
  failed: TriangleAlert,
  cancelled: CircleSlash,
} as const

export function DecideAnalysisCard({
  runId,
  threadId,
}: {
  runId: string
  threadId: string
}) {
  const queryClient = useQueryClient()
  const options = decideAnalysisOptions(threadId, runId)
  const { data, isError } = useQuery(options)
  const cancel = useMutation({
    mutationFn: () => cancelChatDecideAnalysis(threadId, runId),
    onSuccess: (run) => queryClient.setQueryData(options.queryKey, run),
  })
  const view = decideAnalysisCardView({
    status: data?.status ?? null,
    progressMessage: data?.progress?.message ?? null,
    failureMessage: data?.error?.message ?? null,
    loadFailed: isError,
    cancelError: cancel.error,
  })
  const StatusIcon = view.active
    ? null
    : view.label === 'Analysis failed'
      ? TriangleAlert
      : data && data.status in STATUS_ICONS
        ? STATUS_ICONS[data.status as keyof typeof STATUS_ICONS]
        : null
  const files = data?.files ?? []

  return (
    <div className="flex w-full flex-col gap-3">
      <MessageResponse>{DECIDE_ANALYSIS_OPENING_LINE}</MessageResponse>
      <div
        role="status"
        aria-live="polite"
        className="flex w-full items-start gap-3 rounded-lg border border-border bg-muted px-4 py-3 font-sans text-sm"
      >
        {view.active ? (
          <Spinner className="mt-0.5 text-muted-foreground" />
        ) : StatusIcon ? (
          <StatusIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {view.active ? (
              <Shimmer as="span" className="font-medium">
                {view.label}
              </Shimmer>
            ) : (
              <span className="font-medium text-foreground">{view.label}</span>
            )}
            {view.active && data ? (
              <ElapsedTime since={data.startedAt ?? data.createdAt} />
            ) : null}
          </div>
          {view.detail ? (
            <p className="mt-0.5 text-muted-foreground">{view.detail}</p>
          ) : null}
        </div>
        {view.canCancel ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            Cancel
          </Button>
        ) : null}
      </div>
      {files.length > 0 ? (
        <div className="flex w-full flex-col gap-2">
          {files.map((file) => (
            <DecideFileCard key={file.url} file={file} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
