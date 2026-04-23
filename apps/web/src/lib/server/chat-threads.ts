import { eq } from 'drizzle-orm'
import type { UIMessage } from 'ai'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import {
  notFound,
  requireSession,
  requireWorkspaceAccess,
  unauthorized,
} from '@/lib/server/control-plane'

export async function getThreadAccess(request: Request, threadId: string) {
  const session = await requireSession(request)
  if (!session) return unauthorized()

  const db = getDb(appEnv)
  const [thread] = await db
    .select()
    .from(schema.chatThread)
    .where(eq(schema.chatThread.id, threadId))

  if (!thread) return notFound('Chat thread not found')
  if (thread.ownerUserId !== session.user.id) {
    return notFound('Chat thread not found')
  }

  const access = await requireWorkspaceAccess(request, thread.workspaceId)
  if (access instanceof Response) return access

  return { db, session, thread }
}

export function getThreadMessages(thread: { messages: unknown }): UIMessage[] {
  return Array.isArray(thread.messages) ? (thread.messages as UIMessage[]) : []
}

export function getThreadPreview(messages: UIMessage[]) {
  const latest = messages[messages.length - 1]
  if (!latest) return ''

  const text = latest.parts
    .flatMap((part) => {
      if (part.type === 'text' && typeof part.text === 'string') {
        return [part.text.trim()]
      }
      if (part.type === 'file') {
        return [part.filename || 'Attachment']
      }
      return []
    })
    .filter(Boolean)
    .join(' ')
    .trim()

  if (!text) return ''
  return text.length > 120 ? `${text.slice(0, 120).trimEnd()}…` : text
}
