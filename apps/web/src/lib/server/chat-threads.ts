import { eq } from 'drizzle-orm'
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
