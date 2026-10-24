import type { ReactNode } from 'react'
import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { MailQuestion } from 'lucide-react'
import { Result } from 'better-result'
import { toast } from 'sonner'
import { z } from 'zod'
import { Badge } from '@garden/ui/components/ui/badge'
import { Button } from '@garden/ui/components/ui/button'
import { authClient } from '@/lib/auth/client'
import { invitationUnavailableMessages } from '@/lib/invitation-flow'
import { acceptInvitationForCurrentUser } from '@/lib/server/invitations'

export const Route = createFileRoute('/_authenticated/invitations/$id')({
  loader: async ({ params }) => {
    // Guard malformed ids here so the page renders the unavailable state
    // instead of surfacing a server-fn validation throw.
    if (!z.string().uuid().safeParse(params.id).success) {
      return {
        status: 'unavailable' as const,
        reason: 'malformed' as const,
        message: invitationUnavailableMessages.malformed,
      }
    }

    const result = await acceptInvitationForCurrentUser({
      data: { invitationId: params.id },
    })

    if (result.status === 'accepted') {
      throw redirect({
        to: '/home',
        search: {
          workspace_id: result.workspaceId,
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
  const { id: invitationId } = Route.useParams()
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
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <SignOutAndContinueButton invitationId={invitationId} />
          <Button
            variant="outline"
            onClick={() =>
              void navigate({
                to: '/home',
                search: {},
              })
            }
          >
            Back to workspace
          </Button>
        </div>
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
            to: '/home',
            search: {},
          })
        }
      >
        Back to workspace
      </Button>
    </InvitationShell>
  )
}

/**
 * One-click escape for the wrong-account state: signs the current session out
 * and bounces to sign-in with the invite link preserved, so the user lands
 * back in the locked invitation flow instead of a bare auth page. Deliberately
 * bypasses the app-state auth store — its global onLogout callback hard-
 * navigates to bare `/login` (web-providers.tsx), which would drop the invite
 * redirect — and `@/lib/api/auth`, whose transport module chain hangs this
 * route's SSR.
 */
function SignOutAndContinueButton({ invitationId }: { invitationId: string }) {
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)

  return (
    <Button
      disabled={pending}
      onClick={async () => {
        setPending(true)
        const requestResult = await Result.tryPromise({
          try: () => authClient.signOut(),
          catch: (cause) => cause,
        })
        const signOutResult = requestResult.andThen((response) =>
          response.error ? Result.err(response.error) : Result.ok(undefined),
        )

        await signOutResult.match({
          ok: () =>
            navigate({
              to: '/login',
              search: { redirect: `/invitations/${invitationId}` },
            }),
          err: async () => {
            setPending(false)
            toast.error('Could not sign out. Please try again.')
          },
        })
      }}
    >
      {pending ? 'Signing out...' : 'Sign out and continue'}
    </Button>
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,var(--muted)_0,transparent_32rem)] px-6 py-12 text-foreground">
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
