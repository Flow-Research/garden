import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@garden/ui/components/ui/badge'
import { Button } from '@garden/ui/components/ui/button'
import { Spinner } from '@garden/ui/components/ui/spinner'
import { BrandGoogleIcon } from '@/components/icons/brand-google-icon'
import { authClient } from '@/lib/auth/client'
import { authClientOperation } from '@/lib/auth/client-result'
import { hasPasswordSignInMethod } from '@/lib/auth/sign-in-methods'
import { getAuthProviderAvailability } from '@/lib/server/auth-providers'

const authProviderQueryKey = ['auth', 'provider-availability']
const linkedAccountsQueryKey = ['account', 'linked-accounts']

type LinkedAccountState = {
  accounts: Array<{ providerId: string }>
  error: string | null
}

/**
 * Shows Google as an explicit sign-in method. Garden disables Better Auth's
 * implicit linking, so password users must start linking from an authenticated
 * settings page. The account list also prevents the UI from offering an unlink
 * action when Google is the user's only sign-in method. The server repeats this
 * final protection through `allowUnlinkingAll: false`.
 */
export function GoogleAccountConnection() {
  const [linking, setLinking] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const {
    data: authProviders,
    isPending: authProvidersPending,
    isError: authProvidersFailed,
    refetch: refetchAuthProviders,
  } = useQuery({
    queryKey: authProviderQueryKey,
    queryFn: () => getAuthProviderAvailability(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const {
    data: linkedAccountsResult,
    isPending: linkedAccountsPending,
    refetch: refetchLinkedAccounts,
  } = useQuery({
    queryKey: linkedAccountsQueryKey,
    enabled: authProviders?.google === true,
    queryFn: () =>
      authClientOperation({
        fallbackMessage: 'Could not load linked accounts',
        operation: 'list-linked-accounts',
        request: () => authClient.listAccounts(),
      }),
  })

  if (authProvidersPending) return null

  if (authProvidersFailed) {
    return (
      <LinkedAccountsSection>
        <p className="text-sm text-destructive">
          Could not check available sign-in methods.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void refetchAuthProviders()}
        >
          <RefreshCwIcon className="size-4" />
          Retry
        </Button>
      </LinkedAccountsSection>
    )
  }

  if (!authProviders?.google) return null

  const accountState = linkedAccountsResult?.match<LinkedAccountState>({
    ok: (response) => ({
      accounts: (response.data ?? []).map((account) => ({
        providerId: account.providerId,
      })),
      error: null,
    }),
    err: (error) => ({ accounts: [], error: error.message }),
  }) ?? { accounts: [], error: null }
  const googleLinked = accountState.accounts.some(
    (account) => account.providerId === 'google',
  )
  const canUnlinkGoogle =
    googleLinked && hasPasswordSignInMethod(accountState.accounts)

  /** Starts explicit linking and leaves the button busy during navigation. */
  const handleLink = async () => {
    setLinking(true)
    const result = await authClientOperation({
      fallbackMessage: 'Could not link Google',
      operation: 'link-google',
      request: () =>
        authClient.linkSocial({
          provider: 'google',
          callbackURL: window.location.href,
        }),
    })

    result.match({
      ok: () => undefined,
      err: (error) => {
        setLinking(false)
        toast.error(error.message)
      },
    })
  }

  /** Removes Google only when another sign-in method remains. */
  const handleUnlink = async () => {
    setUnlinking(true)
    const result = await authClientOperation({
      fallbackMessage: 'Could not unlink Google',
      operation: 'unlink-google',
      request: () => authClient.unlinkAccount({ providerId: 'google' }),
    })

    await result.match({
      ok: async () => {
        await refetchLinkedAccounts()
        setUnlinking(false)
        toast.success('Google unlinked')
      },
      err: async (error) => {
        setUnlinking(false)
        toast.error(error.message)
      },
    })
  }

  return (
    <LinkedAccountsSection>
      {linkedAccountsPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Checking Google connection...
        </div>
      ) : accountState.error ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-destructive">{accountState.error}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void refetchLinkedAccounts()}
          >
            <RefreshCwIcon className="size-4" />
            Retry
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
              <BrandGoogleIcon className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">Google</p>
                <Badge variant={googleLinked ? 'secondary' : 'outline'}>
                  {googleLinked ? 'Connected' : 'Not connected'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {googleLinked && !canUnlinkGoogle
                  ? 'Google is your only sign-in method.'
                  : 'Use the same email as your Garden account.'}
              </p>
            </div>
          </div>

          {googleLinked ? (
            canUnlinkGoogle ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={unlinking}
                onClick={() => void handleUnlink()}
              >
                {unlinking ? <Spinner aria-hidden="true" /> : null}
                {unlinking ? 'Unlinking...' : 'Unlink'}
              </Button>
            ) : null
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={linking}
              onClick={() => void handleLink()}
            >
              {linking ? <Spinner aria-hidden="true" /> : null}
              {linking ? 'Opening Google...' : 'Link Google'}
            </Button>
          )}
        </div>
      )}
    </LinkedAccountsSection>
  )
}

/** Keeps the linked-account heading consistent across all loading states. */
function LinkedAccountsSection({ children }: { children: React.ReactNode }) {
  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-base font-semibold">Linked accounts</h2>
        <p className="text-sm text-muted-foreground">
          Add Google as a sign-in method for this Garden account.
        </p>
      </header>
      {children}
    </section>
  )
}
