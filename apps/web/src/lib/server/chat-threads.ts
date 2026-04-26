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
  const [row] = await db
    .select({
      thread: schema.chatThread,
      hostName: schema.agent.hostName,
    })
    .from(schema.chatThread)
    .innerJoin(schema.agent, eq(schema.agent.id, schema.chatThread.agentId))
    .where(eq(schema.chatThread.id, threadId))

  if (!row) return notFound('Chat thread not found')
  if (row.thread.ownerUserId !== session.user.id) {
    return notFound('Chat thread not found')
  }
  if (!row.hostName) return notFound('Chat thread agent host missing')

  const access = await requireWorkspaceAccess(request, row.thread.workspaceId)
  if (access instanceof Response) return access

  return {
    db,
    session,
    thread: row.thread,
    hostName: row.hostName,
  }
}
