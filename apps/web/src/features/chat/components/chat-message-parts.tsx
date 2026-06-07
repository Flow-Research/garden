'use client'

/**
 * Chat message JSX rendering. The pure interpretation layer (types, tool/edit
 * helpers, buildMessageRenderModel) lives in `chat-message-model` and is
 * re-exported from here for back-compat; this file owns the React components:
 *
 *   - MessageOrderedParts — thin renderer over buildMessageRenderModel.
 *   - MessageSources, MessageCitations — sources/citation rendering.
 *   - DocumentEditCardsSection — tracked-edit cards.
 *
 * Artifact rendering lives in `chat-artifacts`; the pure interpretation layer
 * in `chat-message-model`.
 */

import { useState } from 'react'
import { Result } from 'better-result'
import {
  buildMessageRenderModel,
  type DocumentEditItem,
  type DocumentEditStatusMap,
} from './chat-message-model'
// Re-export the pure model surface so existing importers (chat-timeline,
// chat-panel-controller, chat-tool-activity, lib/server) keep resolving these
// from chat-message-parts after the model layer was split out.
export * from './chat-message-model'
import { HoverCardTrigger } from '@garden/ui/components/ui/hover-card'
import { resolveDocumentEdit } from '@/lib/api'
import { MessageResponse } from '@/components/ai-elements/message'
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from '@/components/ai-elements/sources'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationQuote,
  InlineCitationSource,
} from '@/components/ai-elements/inline-citation'
import type { GardenArtifactData } from '@/features/artifacts/artifact-renderer'
import type { ChatUiMessage } from '../chat-runtime-provider'
import {
  type DocumentCitationAnnotation,
  type DocumentEditAnnotation,
} from './chat-document-panel'
import {
  PreResponseWrapper,
  StreamingWorkEntryRow,
} from './chat-tool-activity'
import {
  DocumentEditCard,
  applyOptimisticResolutionToOpenDocx,
} from './chat-tracked-edits'
import {
  GardenDocDownloadBlock,
  renderArtifactPart,
} from './chat-artifacts'

// ─── Types ───────────────────────────────────────────────────────────────────


export function MessageSources({ message }: { message: ChatUiMessage }) {
  const sourcePart = message.parts.find(
    (part) => part.type === 'data-sources',
  ) as
    | (ChatUiMessage['parts'][number] & {
        data?: { results?: unknown[] }
      })
    | undefined
  if (!sourcePart || !Array.isArray(sourcePart.data?.results)) return null

  const items = sourcePart.data.results.flatMap(
    (item: unknown, index: number) => {
      if (typeof item === 'string') {
        return [{ href: item, title: item, key: `${item}:${index}` }]
      }
      if (typeof item !== 'object' || item === null) return []

      const candidate = item as { url?: unknown; title?: unknown }
      if (typeof candidate.url !== 'string') return []

      return [
        {
          href: candidate.url,
          title:
            typeof candidate.title === 'string' && candidate.title
              ? candidate.title
              : candidate.url,
          key: `${candidate.url}:${index}`,
        },
      ]
    },
  )

  if (items.length === 0) return null

  return (
    <Sources className="mt-3">
      <SourcesTrigger count={items.length}>Sources</SourcesTrigger>
      <SourcesContent>
        {items.map((item: { href: string; title: string; key: string }) => (
          <Source key={item.key} href={item.href} title={item.title}>
            {item.title}
          </Source>
        ))}
      </SourcesContent>
    </Sources>
  )
}

function DocumentEditCardsSection({
  edits,
  onOpenEdit,
  onResolveError,
  onResolveStart,
  onResolved,
  resolvedStatuses,
}: {
  edits: DocumentEditItem[]
  onOpenEdit?: (
    annotation: DocumentEditAnnotation,
    artifact: GardenArtifactData,
  ) => void
  onResolveError?: (editId: string) => void
  onResolveStart?: (editId: string, status: 'accepted' | 'rejected') => void
  onResolved?: (editId: string, status: 'accepted' | 'rejected') => void
  resolvedStatuses?: DocumentEditStatusMap
}) {
  const [busyEditIds, setBusyEditIds] = useState<string[]>([])
  const resolvedEdits = edits.map((edit) => ({
    ...edit,
    annotation: {
      ...edit.annotation,
      status:
        resolvedStatuses?.[edit.annotation.edit_id] ?? edit.annotation.status,
    },
  }))
  const pendingEdits = resolvedEdits.filter(
    ({ annotation }) => annotation.status === 'pending',
  )
  const busy = busyEditIds.length > 0

  const resolveOne = async (
    edit: DocumentEditItem,
    verb: 'accept' | 'reject',
  ) => {
    const editId = edit.annotation.edit_id
    const nextStatus = verb === 'accept' ? 'accepted' : 'rejected'
    setBusyEditIds((current) => [...new Set([...current, editId])])
    onResolveStart?.(editId, nextStatus)
    const revert = applyOptimisticResolutionToOpenDocx(edit.annotation, verb)
    const result = await Result.tryPromise({
      try: async () => {
        return await resolveDocumentEdit({
          action: verb,
          documentId: edit.annotation.document_id,
          editId,
        })
      },
      catch: () => new Error('Could not resolve edit.'),
    })
    if (result.isOk()) {
      onResolved?.(editId, nextStatus)
    } else {
      revert()
      onResolveError?.(editId)
    }
    setBusyEditIds((current) => current.filter((id) => id !== editId))
  }

  const resolveAll = async (verb: 'accept' | 'reject') => {
    for (const edit of pendingEdits) {
      await resolveOne(edit, verb)
    }
  }

  return (
    <div className="mt-2.5 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <p className="text-xs font-medium text-foreground/80">Tracked Changes</p>
        <p className="ml-auto text-xs text-muted-foreground">
          {pendingEdits.length} pending
        </p>
      </div>
      {pendingEdits.length > 1 ? (
        <div className="flex items-center gap-2 px-3 pt-2.5">
          <button
            type="button"
            onClick={() => void resolveAll('accept')}
            disabled={busy}
            className="px-2 py-1 text-xs rounded border border-foreground bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 inline-flex items-center gap-1"
          >
            Accept all
          </button>
          <button
            type="button"
            onClick={() => void resolveAll('reject')}
            disabled={busy}
            className="px-2 py-1 text-xs rounded border border-border bg-card text-foreground/80 hover:bg-accent disabled:opacity-50 inline-flex items-center gap-1"
          >
            Reject all
          </button>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5 px-3 pb-2.5 pt-2.5">
        {resolvedEdits.map(({ key, annotation, artifact }) => (
          <DocumentEditCard
            key={key}
            annotation={annotation}
            busy={busyEditIds.includes(annotation.edit_id)}
            onResolveError={onResolveError}
            onResolveStart={onResolveStart}
            onView={
              onOpenEdit && artifact
                ? () => onOpenEdit(annotation, artifact)
                : undefined
            }
            onResolved={onResolved}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Thin renderer over `buildMessageRenderModel` (chat-message-model). Owns no
 * interpretation — it maps each typed render node to its element, keeping the
 * parse/group logic testable and out of the React tree.
 */
export function MessageOrderedParts({
  debugMode,
  isLatestStreaming,
  message,
  onOpenDocument,
  onOpenEdit,
  onResolveError,
  onResolveStart,
  onResolved,
  resolvedStatuses,
}: {
  debugMode: boolean
  isLatestStreaming?: boolean
  message: ChatUiMessage
  onOpenDocument?: (artifact: GardenArtifactData) => void
  onOpenEdit?: (
    annotation: DocumentEditAnnotation,
    artifact: GardenArtifactData,
  ) => void
  onResolveError?: (editId: string) => void
  onResolveStart?: (editId: string, status: 'accepted' | 'rejected') => void
  onResolved?: (editId: string, status: 'accepted' | 'rejected') => void
  resolvedStatuses?: DocumentEditStatusMap
}) {
  const nodes = buildMessageRenderModel(message, { debugMode, isLatestStreaming })
  if (nodes.length === 0) return null

  return (
    <>
      {nodes.map((node) => {
        switch (node.kind) {
          case 'reasoning':
            return (
              <Reasoning
                key={node.key}
                isStreaming={node.isStreaming}
                className="w-full"
              >
                <ReasoningTrigger />
                <ReasoningContent>{node.text}</ReasoningContent>
              </Reasoning>
            )
          case 'text':
            return (
              <MessageResponse
                key={node.key}
                isAnimating={node.isAnimating}
                animated={
                  node.isAnimating
                    ? { animation: 'fadeIn', sep: 'word' }
                    : false
                }
              >
                {node.text}
              </MessageResponse>
            )
          case 'work':
            return (
              <PreResponseWrapper
                key={node.key}
                isStreaming={node.active}
                shouldMinimize={false}
                stepCount={node.stepCount}
              >
                {node.entries.map((entry) => (
                  <StreamingWorkEntryRow
                    key={entry.id}
                    entry={entry}
                    showConnector={false}
                  />
                ))}
              </PreResponseWrapper>
            )
          case 'artifact':
            return (
              <GardenDocDownloadBlock
                key={node.key}
                artifact={node.artifact}
                onOpen={
                  onOpenDocument
                    ? () => onOpenDocument(node.artifact)
                    : undefined
                }
              />
            )
          case 'edits':
            return (
              <DocumentEditCardsSection
                key={node.key}
                edits={node.edits}
                onOpenEdit={onOpenEdit}
                onResolveError={onResolveError}
                onResolveStart={onResolveStart}
                onResolved={onResolved}
                resolvedStatuses={resolvedStatuses}
              />
            )
          case 'raw':
            return renderArtifactPart({
              index: node.index,
              messageId: message.id,
              onOpenDocument,
              part: node.part,
            })
        }
      })}
    </>
  )
}

function extractCitations(message: ChatUiMessage) {
  return message.parts.flatMap((part, index) => {
    const record = part as unknown as Record<string, unknown>
    const payloads = [record.data, record.output, record.result, record].filter(
      (value): value is Record<string, unknown> =>
        Boolean(value && typeof value === 'object'),
    )
    return payloads.flatMap((payload, payloadIndex) => {
      const annotations = Array.isArray(payload.annotations)
        ? payload.annotations
        : Array.isArray(payload.citations)
          ? payload.citations
          : []
      return annotations.flatMap((annotation, annotationIndex) => {
        if (!annotation || typeof annotation !== 'object') return []
        const item = annotation as Record<string, unknown>
        const kind = item.kind ?? item.type
        if (kind !== 'citation' && kind !== 'citation_data') return []
        if (
          typeof item.document_id !== 'string' ||
          typeof item.filename !== 'string' ||
          typeof item.quote !== 'string'
        ) {
          return []
        }
        return [
          {
            key: `${message.id}:citation:${index}:${payloadIndex}:${annotationIndex}`,
            citation: {
              document_id: item.document_id,
              filename: item.filename,
              page:
                typeof item.page === 'number' || typeof item.page === 'string'
                  ? item.page
                  : null,
              quote: item.quote,
              ref: typeof item.ref === 'number' ? item.ref : null,
              version_id:
                typeof item.version_id === 'string' ? item.version_id : null,
              version_number:
                typeof item.version_number === 'number'
                  ? item.version_number
                  : null,
            } satisfies DocumentCitationAnnotation,
          },
        ]
      })
    })
  })
}

export function MessageCitations({
  message,
  onOpenCitation,
}: {
  message: ChatUiMessage
  onOpenCitation?: (citation: DocumentCitationAnnotation) => void
}) {
  const citations = extractCitations(message)

  if (citations.length === 0) return null

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {citations.map(({ key, citation }, index) => {
        const quotePreview = citation.quote
          .replaceAll('[[PAGE_BREAK]]', '...')
          .slice(0, 120)
        const pageLabel =
          citation.page != null ? ` · p.${citation.page}` : ''

        return (
          <InlineCitation key={key}>
            <InlineCitationCard>
              <HoverCardTrigger
                render={
                  <button
                    type="button"
                    onClick={() => onOpenCitation?.(citation)}
                    className="inline-flex h-5 min-w-5 cursor-pointer items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/80"
                  />
                }
              >
                {citation.ref ?? index + 1}
              </HoverCardTrigger>
              <InlineCitationCardBody>
                <div className="space-y-2 p-3">
                  <InlineCitationSource
                    title={citation.filename}
                    description={`${citation.document_id}${pageLabel}`}
                  />
                  {quotePreview ? (
                    <InlineCitationQuote>
                      {quotePreview}
                      {citation.quote.length > 120 ? '…' : ''}
                    </InlineCitationQuote>
                  ) : null}
                </div>
              </InlineCitationCardBody>
            </InlineCitationCard>
          </InlineCitation>
        )
      })}
    </div>
  )
}
