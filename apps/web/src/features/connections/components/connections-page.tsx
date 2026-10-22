import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Option } from 'effect'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { mutateConnection, type IntegrationAction } from '@/lib/api'
import {
  connectIntegration,
  searchRegistry,
  type RegistryEntry,
} from '@/lib/api/executor'
import {
  type ExecutorConnectionOwner,
  type ExecutorInstallResponse,
  type ExecutorIntegrationItem,
} from '@/lib/executor-contract'
import { connectionListOptions, workspaceKeys } from '@/lib/workspace/queries'
import { executorRegistryKeys } from '../queries'
import { Button } from '@garden/ui/components/ui/button'
import { Input } from '@garden/ui/components/ui/input'
import { Drawer, DrawerContent } from '@garden/ui/components/ui/drawer'
import { Tabs, TabsList, TabsTrigger } from '@garden/ui/components/ui/tabs'
import {
  SEARCH_DEBOUNCE_MS,
  BROWSE_CATEGORIES,
  type ManagedProvider,
  useDebouncedValue,
} from './connection-helpers'
import { FeaturedCard, FeaturedSkeleton } from './featured-card'
import { SearchResults } from './search-results'
import { InstallDrawerBody } from './install-drawer-body'
import { ManageDrawerBody } from './manage-drawer-body'
import { PreviewToolSkeleton } from './tool-list'

export function ConnectionsPage({
  focusedConnectorId,
  onDismissFocus,
}: {
  focusedConnectorId?: string
  onDismissFocus?: () => void
} = {}) {
  const queryClient = useQueryClient()
  const wsId = useWorkspaceId()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [connectionOwner, setConnectionOwner] =
    useState<ExecutorConnectionOwner>('user')
  const [inspectedEntry, setInspectedEntry] = useState<RegistryEntry | null>(
    null,
  )
  const [managedProvider, setManagedProvider] =
    useState<ManagedProvider | null>(null)

  const closeDrawer = useCallback(() => {
    setManagedProvider(null)
    setInspectedEntry(null)
    onDismissFocus?.()
  }, [onDismissFocus])

  const [inspectingEntryId, setInspectingEntryId] = useState<string | null>(
    null,
  )
  const searchInputRef = useRef<HTMLInputElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)

  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS)
  const searching = debouncedQuery.length > 0 || category !== null

  const snapshotQuery = useQuery(connectionListOptions(wsId))
  const registryQuery = useInfiniteQuery({
    queryKey: executorRegistryKeys.search(debouncedQuery, category),
    queryFn: ({ pageParam }) =>
      searchRegistry({
        q: debouncedQuery || undefined,
        category: category ?? undefined,
        limit: 40,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (page) => Option.getOrUndefined(page.nextOffset),
    enabled: searching,
    staleTime: 10 * 60_000,
  })
  const featuredQuery = useQuery({
    queryKey: executorRegistryKeys.featured(),
    queryFn: () => searchRegistry({ featured: true }),
    staleTime: 60 * 60_000,
  })

  const refreshConnections = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: workspaceKeys.connections(wsId),
    })
  }, [queryClient, wsId])

  useEffect(() => {
    const onOAuthMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (
        typeof event.data !== 'object' ||
        event.data === null ||
        event.data.type !== 'executor-oauth'
      ) {
        return
      }
      if (event.data.ok === true) {
        toast.success('Connection authorized')
        void refreshConnections()
      } else {
        toast.error(
          typeof event.data.error === 'string'
            ? event.data.error
            : 'OAuth authorization failed',
        )
      }
    }
    window.addEventListener('message', onOAuthMessage)
    return () => window.removeEventListener('message', onOAuthMessage)
  }, [refreshConnections])

  const connectionMutation = useMutation({
    mutationFn: (input: { slug: string; action: IntegrationAction }) =>
      mutateConnection(input.slug, input.action),
    onSuccess: refreshConnections,
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : 'Integration action failed',
      ),
  })

  const openOAuth = useCallback((url: string) => {
    const popup = window.open(
      url,
      'executor-oauth',
      'popup=yes,width=620,height=760',
    )
    if (!popup) toast.error('Allow popups to continue with OAuth.')
  }, [])

  const handleInstallResult = useCallback(
    (result: ExecutorInstallResponse, entry: RegistryEntry) => {
      if (result.kind === 'connected') {
        toast.success(`${entry.name} connected`)
        return
      }
      if (result.kind === 'authorization_redirect') {
        window.location.assign(result.connectUrl)
        return
      }
      setManagedProvider({
        providerId: entry.providerId,
        preferredIntegrationSlug: String(result.slug),
      })
    },
    [],
  )

  const directConnectMutation = useMutation({
    mutationFn: connectIntegration,
    onSuccess: async (result, input) => {
      setInspectingEntryId(null)
      setInspectedEntry(null)
      handleInstallResult(result, input.entry)
      await refreshConnections()
    },
    onError: (error) => {
      setInspectingEntryId(null)
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to connect integration',
      )
    },
  })

  const startInstalledConnection = useCallback(
    (integration: ExecutorIntegrationItem) => {
      if (integration.providerId === 'discord.com') {
        window.location.assign('/api/discord/install')
        return
      }
      if (integration.providerId === 'github.com') {
        const url = new URL('/api/github/install', window.location.origin)
        url.searchParams.set('connector_flow', crypto.randomUUID())
        window.location.assign(url.toString())
        return
      }
      connectionMutation.mutate({ slug: integration.slug, action: 'connect' })
    },
    [connectionMutation],
  )

  const snapshot = snapshotQuery.data
  const integrations = useMemo(
    () => snapshot?.integrations ?? [],
    [snapshot?.integrations],
  )
  const installedIntegrations = useMemo(
    () =>
      integrations.filter(
        (integration) =>
          integration.canRemove || integration.connections.length > 0,
      ),
    [integrations],
  )
  const scopedIntegrations = useMemo(
    () =>
      installedIntegrations.filter(
        (integration) =>
          integration.connections.length === 0 ||
          integration.connections.some(
            (connection) => connection.owner === connectionOwner,
          ),
      ),
    [connectionOwner, installedIntegrations],
  )
  const scopedProviderIntegrations = useMemo(
    () => [
      ...new Map(
        scopedIntegrations.map((integration) => [
          integration.providerId,
          integration,
        ]),
      ).values(),
    ],
    [scopedIntegrations],
  )
  const registryEntries = useMemo(() => {
    const entries =
      registryQuery.data?.pages.flatMap((page) => page.entries) ?? []
    return [
      ...new Map(entries.map((entry) => [entry.providerId, entry])).values(),
    ]
  }, [registryQuery.data?.pages])
  const registryTotal = registryQuery.data?.pages[0]?.total ?? 0

  useEffect(() => {
    const target = loadMoreRef.current
    if (!target || !searching || !registryQuery.hasNextPage) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void registryQuery.fetchNextPage()
        }
      },
      { rootMargin: '300px' },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [registryQuery.fetchNextPage, registryQuery.hasNextPage, searching])
  useEffect(() => {
    if (focusedConnectorId === undefined || managedProvider !== null) return
    const focusedIntegration = integrations.find(
      (integration) =>
        integration.slug === focusedConnectorId ||
        integration.providerId === focusedConnectorId,
    )
    if (focusedIntegration === undefined) return
    setManagedProvider({
      providerId: focusedIntegration.providerId,
      preferredIntegrationSlug: focusedIntegration.slug,
    })
  }, [focusedConnectorId, integrations, managedProvider])

  const managedProviderIntegrations =
    managedProvider === null
      ? []
      : integrations.filter(
          (integration) =>
            integration.providerId === managedProvider.providerId,
        )
  const managedIntegration =
    managedProviderIntegrations.find(
      (integration) =>
        integration.slug === managedProvider?.preferredIntegrationSlug,
    ) ??
    managedProviderIntegrations[0] ??
    null
  const managedProviderQuery = useQuery({
    queryKey: executorRegistryKeys.provider(
      managedProvider?.providerId ?? null,
    ),
    queryFn: async () => {
      if (managedProvider === null) {
        throw new Error('No managed provider selected.')
      }
      const response = await searchRegistry({
        q: String(managedProvider.providerId),
        limit: 20,
      })
      const entry = response.entries.find(
        (candidate) => candidate.providerId === managedProvider.providerId,
      )
      if (entry === undefined) {
        throw new Error('Provider is missing from the integration catalog.')
      }
      return entry
    },
    enabled: managedProvider !== null,
    staleTime: 10 * 60_000,
  })
  const managedProviderEntry = managedProviderQuery.data ?? null
  const catalogSize = Option.getOrNull(
    registryQuery.data?.pages[0]?.catalogSize ??
      featuredQuery.data?.catalogSize ??
      Option.none(),
  )

  const clearSearch = useCallback(() => {
    setQuery('')
    setCategory(null)
    searchInputRef.current?.focus()
  }, [])

  const inspectEntry = (entry: RegistryEntry) => {
    setManagedProvider(null)
    setInspectedEntry(entry)
  }

  const manageIntegration = (integrationId: string) => {
    const integration = integrations.find(
      (candidate) => candidate.slug === integrationId,
    )
    if (integration === undefined) return
    setInspectedEntry(null)
    setManagedProvider({
      providerId: integration.providerId,
      preferredIntegrationSlug: integration.slug,
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="px-8 pt-6 pb-1">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-lg font-semibold tracking-[-0.015em] text-foreground">
            Connections
          </h1>
          {catalogSize !== null ? (
            <p className="text-xs text-muted-foreground">
              {catalogSize.toLocaleString()} integrations in the catalog
            </p>
          ) : null}
        </div>
        <p className="mt-0.5 max-w-prose text-[13px] text-muted-foreground">
          Everything your agents can reach — connect a featured tool or search
          the whole catalog.
        </p>

        <Tabs
          value={connectionOwner}
          onValueChange={(value) => {
            if (value === 'user' || value === 'org') setConnectionOwner(value)
          }}
          className="mt-4"
        >
          <TabsList variant="line" aria-label="Connection ownership">
            <TabsTrigger value="user">Personal</TabsTrigger>
            <TabsTrigger value="org">Workspace</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative mt-4 max-w-2xl">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              catalogSize
                ? `Search ${catalogSize.toLocaleString()} integrations…`
                : 'Search integrations…'
            }
            aria-label="Search integrations"
            className="h-10 bg-background pl-9 pr-9 text-sm"
          />
          {query || category ? (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear search"
              className="absolute top-1/2 right-2.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        <div
          className="mt-2.5 flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Browse by category"
        >
          {BROWSE_CATEGORIES.map((chip) => {
            const active = category === chip.value
            return (
              <button
                key={chip.value}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(active ? null : chip.value)}
                className={[
                  'h-6 rounded-full border px-2.5 text-[11px] font-medium transition-colors motion-reduce:transition-none',
                  active
                    ? 'border-success/40 bg-success/10 text-success'
                    : 'border-border/60 bg-muted/30 text-muted-foreground hover:border-border hover:text-foreground',
                ].join(' ')}
              >
                {chip.label}
              </button>
            )
          })}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-4 pb-10">
        {searching && (
          <SearchResults
            entries={registryEntries}
            total={registryTotal}
            loading={registryQuery.isLoading}
            loadingMore={registryQuery.isFetchingNextPage}
            loadMoreRef={loadMoreRef}
            error={registryQuery.isError ? registryQuery.error : null}
            installed={integrations}
            inspectingEntryId={inspectingEntryId}
            onClear={clearSearch}
            onRetry={() => registryQuery.refetch()}
            onInspect={inspectEntry}
            onManage={manageIntegration}
          />
        )}
        {!searching && (snapshotQuery.isLoading || featuredQuery.isLoading) && (
          <FeaturedSkeleton />
        )}
        {!searching && !snapshotQuery.isLoading && !featuredQuery.isLoading && (
          <>
            {scopedProviderIntegrations.length > 0 ? (
              <section aria-label="Your connections">
                <h2 className="text-sm font-semibold text-foreground">
                  {connectionOwner === 'user'
                    ? 'Personal connections'
                    : 'Workspace connections'}
                </h2>
                <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2">
                  {scopedProviderIntegrations.map((integration) => (
                    <FeaturedCard
                      key={integration.slug}
                      entry={{
                        providerId: integration.providerId,
                        name: integration.label,
                        description: integration.description,
                        icon: integration.icon,
                      }}
                      integration={integration}
                      highlighted={
                        focusedConnectorId === integration.providerId
                      }
                      busy={false}
                      onInspect={() => undefined}
                      onManage={() => manageIntegration(integration.slug)}
                    />
                  ))}
                </ul>
              </section>
            ) : null}

            <section
              aria-label="Featured integrations"
              className={scopedProviderIntegrations.length > 0 ? 'mt-7' : ''}
            >
              <h2 className="text-sm font-semibold text-foreground">
                Featured
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Recommended for shared company context, communication, and
                execution.
              </p>
              <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2">
                {(featuredQuery.data?.entries ?? [])
                  .filter(
                    (entry) =>
                      !installedIntegrations.some(
                        (integration) =>
                          integration.providerId === entry.providerId,
                      ),
                  )
                  .map((entry) => (
                    <FeaturedCard
                      key={entry.providerId}
                      entry={entry}
                      integration={null}
                      highlighted={focusedConnectorId === entry.providerId}
                      busy={inspectingEntryId === entry.providerId}
                      onInspect={() => inspectEntry(entry)}
                      onManage={() => undefined}
                    />
                  ))}
              </ul>
            </section>
          </>
        )}
      </div>

      <Drawer
        open={managedProvider !== null || inspectedEntry !== null}
        onOpenChange={(open) => {
          if (open) return
          closeDrawer()
        }}
        direction="right"
      >
        <DrawerContent className="data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-2xl">
          {inspectedEntry ? (
            <InstallDrawerBody
              key={inspectedEntry.providerId}
              entry={inspectedEntry}
              pending={directConnectMutation.isPending}
              onClose={closeDrawer}
              onInstall={(source) => {
                setInspectingEntryId(inspectedEntry.providerId)
                directConnectMutation.mutate({
                  entry: inspectedEntry,
                  source,
                  owner: connectionOwner,
                })
              }}
            />
          ) : null}
          {managedIntegration && managedProviderEntry ? (
            <ManageDrawerBody
              key={`${managedIntegration.slug}:${connectionOwner}`}
              entry={managedProviderEntry}
              integration={managedIntegration}
              providerIntegrations={managedProviderIntegrations}
              owner={connectionOwner}
              pending={
                connectionMutation.isPending || directConnectMutation.isPending
              }
              onClose={closeDrawer}
              onConnect={startInstalledConnection}
              onOAuth={openOAuth}
              onConnected={refreshConnections}
              onManageSource={(slug) =>
                setManagedProvider({
                  providerId: managedIntegration.providerId,
                  preferredIntegrationSlug: slug,
                })
              }
              onInstall={(source) =>
                directConnectMutation.mutate({
                  entry: managedProviderEntry,
                  source,
                  owner: connectionOwner,
                })
              }
              onAction={(slug, action) =>
                connectionMutation.mutate({ slug, action })
              }
            />
          ) : null}
          {managedProvider && managedProviderQuery.isLoading ? (
            <div className="p-6">
              <PreviewToolSkeleton />
            </div>
          ) : null}
          {managedProvider && managedProviderQuery.isError ? (
            <div className="p-6">
              <p className="text-sm text-muted-foreground">
                Garden could not load this provider’s available sources.
              </p>
              <Button
                className="mt-4"
                size="sm"
                onClick={() => void managedProviderQuery.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : null}
        </DrawerContent>
      </Drawer>
    </div>
  )
}
