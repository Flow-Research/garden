import { Effect, Result } from 'effect'
import { createFileRoute } from '@tanstack/react-router'
import { requireAppRequestContext } from '@/lib/server/context'
import { requireWorkspaceContext } from '@/lib/server/control-plane'
import { appEnv } from '@/lib/server/env'
import { captureApiFailure } from '@/lib/server/api-logging'
import { buildDiscordInstallRedirect } from '@/lib/server/discord-install'
import {
  requireWorkspacePermission,
  workspacePermissions,
} from '@/lib/server/workspace-permissions'

/** Starts installation of Garden's shared Discord bot for the active workspace. */
export const Route = createFileRoute('/api/discord/install')({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const appContext = requireAppRequestContext(context)
        const workspaceContext = await requireWorkspaceContext(appContext)
        if (workspaceContext instanceof Response) return workspaceContext

        const permission = await requireWorkspacePermission({
          appContext,
          request,
          workspaceId: workspaceContext.workspaceId,
          permissions: workspacePermissions.connectionManage,
        })
        if (permission) return permission

        const result = await Effect.runPromise(
          Effect.result(
            buildDiscordInstallRedirect({
              env: appEnv,
              request,
              userId: workspaceContext.session.user.id,
              workspaceId: workspaceContext.workspaceId,
            }),
          ),
        )
        if (Result.isFailure(result)) {
          await captureApiFailure({
            request,
            event: 'discord.install.start_failed',
            error: result.failure,
          })
          return Response.json(
            { error: result.failure.message },
            { status: 500 },
          )
        }
        return new Response(null, {
          status: 302,
          headers: { location: result.success },
        })
      },
    },
  },
})
