import { eq } from 'drizzle-orm'
import { schema } from '@/lib/server/db'
import type { AppRequestContext } from '@/lib/server/context'
import {
  notFound,
  requireSession,
  requireWorkspaceAccess,
  unauthorized,
} from '@/lib/server/control-plane'

export async function getThreadAccess(
  appContext: AppRequestContext,
  threadId: string,
) {
  const session = await requireSession(appContext)
  if (!session) return unauthorized()

  const db = await appContext.db()
  const [row] = await db
    .select({
      thread: schema.chatThread,
      hostName: schema.agent.hostName,
    })
    .from(schema.chatThread)
    .innerJoin(schema.agent, eq(schema.agent.id, schema.chatThread.agentId))
    .where(eq(schema.chatThread.id, threadId))

  if (!row) return notFound('Chat thread not found')
  if (!row.hostName) return notFound('Chat thread agent not found')
  if (row.thread.ownerUserId !== session.user.id) {
    return notFound('Chat thread not found')
  }
  const access = await requireWorkspaceAccess(
    appContext,
    row.thread.workspaceId,
  )
  if (access instanceof Response) return access

  return {
    db,
    session,
    thread: row.thread,
    hostName: row.hostName,
  }
}
