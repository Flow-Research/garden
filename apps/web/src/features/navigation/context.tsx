import { createContext, useContext, useMemo } from 'react'
import type { NavigationActions, NavigationAdapter } from './types'

const NavigationContext = createContext<NavigationAdapter | null>(null)
// Actions only. They do not change when the URL does, so components that
// only navigate (editors, comment bodies, links) are not re-rendered by
// every navigation, as they were when they read the full adapter.
const NavigationActionsContext = createContext<NavigationActions | null>(null)

export function NavigationProvider({
  value,
  children,
}: {
  value: NavigationAdapter
  children: React.ReactNode
}) {
  const { push, replace, back, openInNewTab, getShareableUrl } = value
  const actions = useMemo<NavigationActions>(
    () => ({ push, replace, back, openInNewTab, getShareableUrl }),
    [push, replace, back, openInNewTab, getShareableUrl],
  )
  return (
    <NavigationActionsContext.Provider value={actions}>
      <NavigationContext.Provider value={value}>
        {children}
      </NavigationContext.Provider>
    </NavigationActionsContext.Provider>
  )
}

/** The adapter with the current pathname and search params. */
export function useNavigation(): NavigationAdapter {
  const ctx = useContext(NavigationContext)
  if (!ctx)
    throw new Error('useNavigation must be used within NavigationProvider')
  return ctx
}

/** Navigation actions only; does not re-render on URL changes. */
export function useNavigationActions(): NavigationActions {
  const ctx = useContext(NavigationActionsContext)
  if (!ctx)
    throw new Error(
      'useNavigationActions must be used within NavigationProvider',
    )
  return ctx
}
