'use client'

import {
  DocumentArtifact,
  type DocumentArtifactData,
} from './document-artifact'

export type GardenArtifactData = DocumentArtifactData
export type GardenArtifactHighlight = {
  deletedText?: string
  delWId?: string | null
  insertedText?: string
  insWId?: string | null
  key: string
}

export type GardenCitationQuote = {
  page?: number | string | null
  quote: string
}

export type GardenArtifactOptimisticResolution = {
  action: 'accept' | 'reject'
  deletedText?: string
  delWId?: string | null
  insertedText?: string
  insWId?: string | null
  key: string
  nonce: number
}

export function normalizeGardenArtifact(
  value: unknown,
): GardenArtifactData | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const candidate =
    record.artifact && typeof record.artifact === 'object'
      ? (record.artifact as Record<string, unknown>)
      : record

  if (candidate.kind !== 'document') return null
  if (typeof candidate.filename !== 'string') return null

  return {
    kind: 'document',
    id: typeof candidate.id === 'string' ? candidate.id : null,
    filename: candidate.filename,
    title: typeof candidate.title === 'string' ? candidate.title : undefined,
    versionId:
      typeof candidate.versionId === 'string'
        ? candidate.versionId
        : typeof candidate.version_id === 'string'
          ? candidate.version_id
          : null,
    mediaType:
      typeof candidate.mediaType === 'string'
        ? candidate.mediaType
        : typeof candidate.media_type === 'string'
          ? candidate.media_type
          : null,
    url:
      typeof candidate.url === 'string'
        ? candidate.url
        : typeof candidate.download_url === 'string'
          ? candidate.download_url
          : null,
    content: typeof candidate.content === 'string' ? candidate.content : null,
    versionNumber:
      typeof candidate.versionNumber === 'number'
        ? candidate.versionNumber
        : typeof candidate.version_number === 'number'
          ? candidate.version_number
        : null,
  }
}

export function GardenArtifact({
  chrome,
  data,
  highlight,
  optimisticResolution,
  quotes,
  refreshKey,
}: {
  chrome?: boolean
  data: GardenArtifactData
  highlight?: GardenArtifactHighlight | null
  optimisticResolution?: GardenArtifactOptimisticResolution | null
  quotes?: GardenCitationQuote[]
  refreshKey?: number
}) {
  return (
    <DocumentArtifact
      chrome={chrome}
      data={data}
      highlight={highlight}
      optimisticResolution={optimisticResolution}
      quotes={quotes}
      refreshKey={refreshKey}
    />
  )
}
