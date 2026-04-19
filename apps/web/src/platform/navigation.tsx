import { Suspense, useMemo } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import {
  NavigationProvider,
  type NavigationAdapter,
} from '@/features/navigation'

function NavigationProviderInner({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()

  const adapter = useMemo<NavigationAdapter>(
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
      pathname: location.pathname,
      searchParams: new URLSearchParams(location.searchStr),
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
    [location.pathname, location.searchStr, navigate],
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
