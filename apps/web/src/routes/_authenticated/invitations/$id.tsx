import type { ReactNode } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { MailQuestion } from 'lucide-react'
import { Badge } from '@garden/ui/components/ui/badge'
import { Button } from '@garden/ui/components/ui/button'
import { acceptInvitationForCurrentUser } from '@/lib/server/invitations'

export const Route = createFileRoute('/_authenticated/invitations/$id')({
  loader: async ({ params }) => {
    const result = await acceptInvitationForCurrentUser({
      data: { invitationId: params.id },
    })

    if (result.status === 'accepted') {
      throw redirect({
        to: '/workspace',
        search: {
          connector_flow: undefined,
          connector_id: undefined,
          workspace_id: result.workspaceId,
          issue: undefined,
        },
      })
    }

    return result
  },
  component: InvitationRoute,
})

/**
 * Shows only exception states for invitation links. The normal email-link path
 * auto-accepts in the route loader and redirects to the workspace, so users do
 * not see a second consent screen or a "go to workspace" interstitial. This
 * page remains for safety cases like account/email mismatch or used invites.
 */
function InvitationRoute() {
  const result = Route.useLoaderData()
  const navigate = useNavigate()

  if (result.status === 'email_mismatch') {
    return (
      <InvitationShell
        eyebrow="Wrong account"
        title="This invite is for a different email"
        description={
          result.organizationName
            ? `${result.organizationName} invited ${result.invitationEmail}, but you are signed in as ${result.sessionEmail}. Sign out and create or use the invited account to join.`
            : `This invite is for ${result.invitationEmail}, but you are signed in as ${result.sessionEmail}. Sign out and create or use the invited account to join.`
        }
      >
        <Button
          className="mt-8"
          onClick={() =>
            void navigate({
              to: '/workspace',
              search: {
                connector_flow: undefined,
                connector_id: undefined,
                workspace_id: undefined,
                issue: undefined,
              },
            })
          }
        >
          Back to workspace
        </Button>
      </InvitationShell>
    )
  }

  return (
    <InvitationShell
      eyebrow="Invitation unavailable"
      title="We could not open this invite"
      description={result.message}
    >
      <Button
        className="mt-8"
        onClick={() =>
          void navigate({
            to: '/workspace',
            search: {
              connector_flow: undefined,
              connector_id: undefined,
              workspace_id: undefined,
              issue: undefined,
            },
          })
        }
      >
        Back to workspace
      </Button>
    </InvitationShell>
  )
}

function InvitationShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description?: string
  children?: ReactNode
}) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,hsl(var(--muted))_0,transparent_32rem)] px-6 py-12 text-foreground">
      <section className="mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-3xl flex-col justify-center border-l pl-8 sm:pl-12">
        <Badge variant="outline" className="mb-6 w-fit gap-1.5 rounded-full">
          <MailQuestion className="h-3.5 w-3.5" />
          {eyebrow}
        </Badge>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-[-0.05em] text-balance sm:text-6xl">
          {title}
        </h1>
        {description && (
          <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground">
            {description}
          </p>
        )}
        {children}
      </section>
    </main>
  )
}
