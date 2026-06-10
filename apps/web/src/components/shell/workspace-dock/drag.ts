import { Result } from 'better-result'

export const chatSessionDragType = 'application/garden-chat-session'

/** Detects Garden chat-session drags before handing them to FlexLayout external drop. */
export function hasChatSessionDragData(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes(chatSessionDragType)
}

/** Parses the custom drag payload produced by the chat session explorer. */
export function parseChatSessionDragPayload(dataTransfer: DataTransfer) {
  const raw = dataTransfer.getData(chatSessionDragType)
  if (!raw) return null
  const parsed = Result.try(() => JSON.parse(raw) as unknown)
  if (Result.isError(parsed)) return null
  const value = parsed.value
  if (!value || typeof value !== 'object') return null
  const session = value as { id?: unknown; title?: unknown }
  if (typeof session.id !== 'string' || typeof session.title !== 'string') {
    return null
  }
  return { id: session.id, title: session.title }
}
