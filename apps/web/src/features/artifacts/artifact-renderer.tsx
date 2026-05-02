'use client'

import { DocumentArtifact, type DocumentArtifactData } from './document-artifact'

export type GardenArtifactData = DocumentArtifactData

export function normalizeGardenArtifact(value: unknown): GardenArtifactData | null {
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
    mediaType:
      typeof candidate.mediaType === 'string' ? candidate.mediaType : null,
    url: typeof candidate.url === 'string' ? candidate.url : null,
    content: typeof candidate.content === 'string' ? candidate.content : null,
    versionNumber:
      typeof candidate.versionNumber === 'number'
        ? candidate.versionNumber
        : null,
  }
}

export function GardenArtifact({
  chrome,
  data,
}: {
  chrome?: boolean
  data: GardenArtifactData
}) {
  return <DocumentArtifact chrome={chrome} data={data} />
}
