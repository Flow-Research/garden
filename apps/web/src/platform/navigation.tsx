import { Suspense, useMemo } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import {
  NavigationProvider,
  type NavigationActions,
  type NavigationAdapter,
} from '@/features/navigation'

function NavigationProviderInner({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()

  // The actions depend only on navigate, so they keep their identity across
  // URL changes (see useNavigationActions).
  const actions = useMemo<NavigationActions>(
    () => ({
      push: (path) => {
        void navigate({ to: path })
      },
      replace: (path) => {
        void navigate({ to: path, replace: true })
      },
      back: () => {
        if (typeof window !== 'undefined') {
          window.history.back()
        }
      },
      openInNewTab: (path) => {
        if (typeof window !== 'undefined') {
          window.open(path, '_blank', 'noopener,noreferrer')
        }
      },
      getShareableUrl: (path) => {
        if (typeof window === 'undefined') {
          return path
        }

        return new URL(path, window.location.origin).toString()
      },
    }),
    [navigate],
  )

  const adapter = useMemo<NavigationAdapter>(
    () => ({
      ...actions,
      pathname: location.pathname,
      searchParams: new URLSearchParams(location.searchStr),
    }),
    [actions, location.pathname, location.searchStr],
  )

  return <NavigationProvider value={adapter}>{children}</NavigationProvider>
}

export function WebNavigationProvider({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Suspense>
      <NavigationProviderInner>{children}</NavigationProviderInner>
    </Suspense>
  )
}
