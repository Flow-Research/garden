import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { Option, Schema } from 'effect'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useWorkspaceId } from '@garden/app-state/hooks'
import { Loader2, MoreHorizontal, Plug, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { mutateConnection, type IntegrationAction } from '@/lib/api'
import {
  connectIntegration,
  createExecutorConnection,
  executorOAuthStartUrl,
  previewIntegrationTools,
  searchRegistry,
  type RegistryEntry,
} from '@/lib/api/executor'
import {
  type ExecutorConnectionOwner,
  type ExecutorInstallResponse,
  type ExecutorIntegrationItem,
  ExecutorIntegrationSource,
  type ExecutorIntegrationStatus,
  type ExecutorIntegrationTool,
  type ExecutorToolPreviewItem,
} from '@/lib/executor-contract'
import { connectionListOptions, workspaceKeys } from '@/lib/workspace/queries'
import { notifyConnectionsChanged } from '@/features/connections/events'
import { Button } from '@garden/ui/components/ui/button'
import { Input } from '@garden/ui/components/ui/input'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@garden/ui/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@garden/ui/components/ui/tabs'

const SEARCH_DEBOUNCE_MS = 150

const BROWSE_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'productivity', label: 'Productivity' },
  { value: 'developer_tools', label: 'Developer tools' },
  { value: 'messaging', label: 'Messaging' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'media', label: 'Media' },
  { value: 'financial', label: 'Finance' },
]

type ProviderCardEntry = {
  readonly providerId: string
  readonly name: string
  readonly description: string
  readonly icon: Option.Option<string>
}

type ManagedProvider = {
  readonly providerId: string
  readonly preferredIntegrationSlug: string | null
}

function useDebouncedValue(value: string, delayMs: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timeout)
  }, [value, delayMs])
  return debounced
}

function statusDotColor(status: ExecutorIntegrationStatus) {
  if (status === 'connected') return 'bg-moss'
  if (status === 'degraded') return 'bg-amber-500'
  return 'bg-stone-400'
}

function statusLabelFor(status: ExecutorIntegrationStatus) {
  if (status === 'connected') return 'Connected'
  if (status === 'degraded') return 'Needs attention'
  if (status === 'setup_required') return 'Setup required'
  return 'Available'
}

function formatToolName(raw: string) {
  const cleaned = raw.replace(/[_-]+/g, ' ').trim()
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : raw
}

function ProviderIcon({
  icon,
  className,
}: {
  icon: Option.Option<string>
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  if (Option.isNone(icon) || failed) {
    return <Plug className={className} aria-hidden="true" />
  }
  return (
    <img
      src={icon.value}
      alt=""
      loading="lazy"
      className={className}
      onError={() => setFailed(true)}
    />
  )
}

export function ConnectionsPage({
  focusedConnectorId,
}: {
  focusedConnectorId?: string
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

  const [inspectingEntryId, setInspectingEntryId] = useState<string | null>(
    null,
  )
  const searchInputRef = useRef<HTMLInputElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)

  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS)
  const searching = debouncedQuery.length > 0 || category !== null

  const snapshotQuery = useQuery(connectionListOptions(wsId))
  const registryQuery = useInfiniteQuery({
    queryKey: ['executor-registry', debouncedQuery, category],
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
    queryKey: ['executor-registry-featured'],
    queryFn: () => searchRegistry({ featured: true }),
    staleTime: 60 * 60_000,
  })

  const refreshConnections = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.connections(wsId),
      }),
      queryClient.invalidateQueries({
        queryKey: ['workspace-connections-sidebar'],
      }),
    ])
    notifyConnectionsChanged()
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
        window.location.assign('/api/github/install')
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
    queryKey: [
      'executor-registry-provider',
      managedProvider?.providerId ?? null,
    ],
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
                    ? 'border-moss/40 bg-moss/10 text-moss'
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
          setManagedProvider(null)
          setInspectedEntry(null)
        }}
        direction="right"
      >
        <DrawerContent className="data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-2xl">
          {inspectedEntry ? (
            <InstallDrawerBody
              key={inspectedEntry.providerId}
              entry={inspectedEntry}
              pending={directConnectMutation.isPending}
              onClose={() => setInspectedEntry(null)}
              onInstall={(source) => {
                setInspectingEntryId(inspectedEntry.providerId)
                directConnectMutation.mutate({
                  entry: inspectedEntry,
                  source,
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
              onClose={() => setManagedProvider(null)}
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

function FeaturedCard({
  entry,
  integration,
  highlighted,
  busy,
  onInspect,
  onManage,
}: {
  entry: ProviderCardEntry
  integration: ExecutorIntegrationItem | null
  highlighted: boolean
  busy: boolean
  onInspect: () => void
  onManage: () => void
}) {
  const cardRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (highlighted) cardRef.current?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  const connected = integration?.status === 'connected'
  const degraded = integration?.status === 'degraded'
  const installed = integration !== null
  let actionContent: ReactNode = 'Connect'
  if (installed) actionContent = 'Manage'
  if (busy) {
    actionContent = (
      <>
        <Loader2 className="size-3 animate-spin" />
        Connecting…
      </>
    )
  }
  let statusText = 'setup required'
  if (connected) statusText = 'connected'
  if (degraded) statusText = 'needs attention'

  return (
    <li
      ref={cardRef}
      className={[
        'flex flex-col rounded-xl border bg-background p-2.5 transition-colors motion-reduce:transition-none',
        highlighted ? 'border-moss/50' : 'border-border/60',
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/40">
          <ProviderIcon icon={entry.icon} className="size-4.5 object-contain" />
        </span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {entry.name}
        </h3>
      </div>
      <p className="mt-0.5 mb-2 h-8 flex-1 overflow-hidden text-xs leading-4 text-muted-foreground">
        {entry.description}
      </p>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            size="sm"
            variant={installed ? 'outline' : 'default'}
            className="h-7 text-xs"
            disabled={busy}
            onClick={installed ? onManage : onInspect}
          >
            {actionContent}
          </Button>
          {installed ? (
            <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full bg-muted/40 px-2 text-[11px] font-medium text-muted-foreground">
              <span
                className={`size-1.5 rounded-full ${statusDotColor(integration.status)}`}
              />
              {statusText}
            </span>
          ) : null}
        </div>
        {integration && integration.tools.length > 0 ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {integration.tools.length} tools
          </span>
        ) : null}
      </div>
    </li>
  )
}

function SearchResults({
  entries,
  total,
  loading,
  loadingMore,
  loadMoreRef,
  error,
  installed,
  inspectingEntryId,
  onClear,
  onRetry,
  onInspect,
  onManage,
}: {
  entries: RegistryEntry[]
  total: number
  loading: boolean
  loadingMore: boolean
  loadMoreRef: RefObject<HTMLDivElement | null>
  error: unknown
  installed: readonly ExecutorIntegrationItem[]
  inspectingEntryId: string | null
  onClear: () => void
  onRetry: () => void
  onInspect: (entry: RegistryEntry) => void
  onManage: (id: string) => void
}) {
  if (loading) {
    return (
      <ul
        aria-hidden="true"
        className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2"
      >
        {Array.from({ length: 8 }, (_, index) => (
          <li
            key={index}
            className="h-36 animate-pulse rounded-xl bg-muted/20"
          />
        ))}
      </ul>
    )
  }
  if (error) {
    return (
      <div className="flex flex-col items-start gap-2 py-8 text-sm">
        <p className="text-foreground">
          The integration catalog is unreachable.
        </p>
        <p className="text-muted-foreground">
          {error instanceof Error ? error.message : 'Try again in a moment.'}
        </p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    )
  }
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 py-8">
        <p className="text-sm text-foreground">No integrations match.</p>
        <p className="text-sm text-muted-foreground">
          Try a provider name, API, or domain.
        </p>
        <Button size="sm" variant="outline" onClick={onClear}>
          Clear search
        </Button>
      </div>
    )
  }
  return (
    <section aria-label="Search results">
      <p className="text-xs text-muted-foreground">
        {total.toLocaleString()} match{total === 1 ? '' : 'es'}
        {total > entries.length ? `, showing ${entries.length}` : ''}
      </p>
      <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
        {entries.map((entry) => {
          const current = installed.find(
            (integration) => integration.providerId === entry.providerId,
          )
          return (
            <FeaturedCard
              key={entry.providerId}
              entry={entry}
              integration={current ?? null}
              highlighted={false}
              busy={inspectingEntryId === entry.providerId}
              onInspect={() => onInspect(entry)}
              onManage={() => current && onManage(current.slug)}
            />
          )
        })}
      </ul>
      <div ref={loadMoreRef} className="flex h-16 items-center justify-center">
        {loadingMore ? (
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-label="Loading more integrations"
          />
        ) : null}
      </div>
    </section>
  )
}

function installedIntegrationSource(
  integration: ExecutorIntegrationItem,
): ExecutorIntegrationSource {
  if (
    integration.protocol === 'github-app' ||
    integration.protocol === 'discord-bot' ||
    integration.protocol === 'native'
  ) {
    return 'native'
  }
  if (
    integration.protocol === 'google-api' ||
    integration.protocol === 'openapi'
  ) {
    return 'openapi'
  }
  if (integration.protocol === 'graphql') return 'graphql'
  return 'mcp'
}

function sourceLabel(source: ExecutorIntegrationSource): string {
  if (source === 'mcp') return 'MCP'
  if (source === 'openapi') return 'OpenAPI'
  if (source === 'graphql') return 'GraphQL'
  return 'Native'
}

function sourceDescription(source: ExecutorIntegrationSource): string {
  if (source === 'mcp') {
    return 'Use the provider’s remote MCP server and its published tools.'
  }
  if (source === 'openapi') {
    return 'Generate tools from the provider’s server-owned API definition.'
  }
  if (source === 'graphql') {
    return 'Generate tools from the provider’s server-owned GraphQL schema.'
  }
  return 'Use Garden’s provider-owned application and installation flow.'
}

function InstallDrawerBody({
  entry,
  pending,
  onInstall,
  onClose,
}: {
  entry: RegistryEntry
  pending: boolean
  onInstall: (source: ExecutorIntegrationSource) => void
  onClose: () => void
}) {
  const [source, setSource] = useState<ExecutorIntegrationSource>(
    entry.sources[0],
  )
  const previewQuery = useQuery({
    queryKey: ['executor-tool-preview', entry.providerId, source],
    queryFn: () => previewIntegrationTools({ entry, source }),
    staleTime: 10 * 60_000,
  })

  return (
    <>
      <DrawerHeader className="border-b">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <ProviderIcon icon={entry.icon} className="size-5 shrink-0" />
            <DrawerTitle className="truncate">{entry.name}</DrawerTitle>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="size-7 p-0 text-muted-foreground"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>
        <DrawerDescription>{entry.description}</DrawerDescription>
      </DrawerHeader>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <section>
          <h3 className="text-sm font-semibold text-foreground">Tool source</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose which server-owned source Garden should install.
          </p>
          <Tabs
            value={source}
            onValueChange={(value) => {
              const decoded = Schema.decodeUnknownOption(
                ExecutorIntegrationSource,
              )(value)
              if (
                Option.isSome(decoded) &&
                entry.sources.includes(decoded.value)
              ) {
                setSource(decoded.value)
              }
            }}
            className="mt-4"
          >
            <TabsList
              variant="line"
              className="max-w-full justify-start overflow-x-auto"
              aria-label="Tool source"
            >
              {entry.sources.map((candidate) => (
                <TabsTrigger key={candidate} value={candidate}>
                  {sourceLabel(candidate)}
                </TabsTrigger>
              ))}
            </TabsList>
            {entry.sources.map((candidate) => (
              <TabsContent
                key={candidate}
                value={candidate}
                className="pt-4 text-sm text-muted-foreground"
              >
                {sourceDescription(candidate)}
              </TabsContent>
            ))}
          </Tabs>

          <Button
            className="mt-5"
            disabled={
              pending || previewQuery.data?.status === 'definition_missing'
            }
            onClick={() => onInstall(source)}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {previewQuery.data?.status === 'definition_missing'
              ? `${sourceLabel(source)} definition unavailable`
              : `Install ${sourceLabel(source)}`}
          </Button>
        </section>

        <section className="mt-8 border-t pt-6" aria-live="polite">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-sm font-semibold text-foreground">Tools</h3>
            {Option.getOrNull(previewQuery.data?.toolCount ?? Option.none()) !==
            null ? (
              <span className="text-xs text-muted-foreground">
                {Option.getOrNull(
                  previewQuery.data?.toolCount ?? Option.none(),
                )}
              </span>
            ) : null}
          </div>
          {previewQuery.isLoading ? <PreviewToolSkeleton /> : null}
          {previewQuery.isError ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Garden could not load this tool preview. Try the source again.
            </p>
          ) : null}
          {previewQuery.data ? (
            <>
              {previewQuery.data.tools.length > 0 ? (
                <PreviewToolList tools={previewQuery.data.tools} />
              ) : (
                <p className="mt-3 max-w-prose text-sm text-muted-foreground">
                  {previewQuery.data.message}
                </p>
              )}
            </>
          ) : null}
        </section>
      </div>
    </>
  )
}

function ManageDrawerBody({
  entry,
  integration,
  providerIntegrations,
  owner,
  pending,
  onConnect,
  onOAuth,
  onConnected,
  onManageSource,
  onInstall,
  onAction,
  onClose,
}: {
  entry: RegistryEntry
  integration: ExecutorIntegrationItem
  providerIntegrations: readonly ExecutorIntegrationItem[]
  owner: ExecutorConnectionOwner
  pending: boolean
  onConnect: (integration: ExecutorIntegrationItem) => void
  onOAuth: (url: string) => void
  onConnected: () => Promise<void>
  onManageSource: (slug: string) => void
  onInstall: (source: ExecutorIntegrationSource) => void
  onAction: (slug: string, action: IntegrationAction) => void
  onClose: () => void
}) {
  const initialMethod = integration.authMethods[0]
  const installedSource = installedIntegrationSource(integration)
  const [source, setSource] =
    useState<ExecutorIntegrationSource>(installedSource)
  const [methodId, setMethodId] = useState(initialMethod?.id ?? '')
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const method = integration.authMethods.find(
    (candidate) => candidate.id === methodId,
  )
  const nativeProvider =
    integration.providerId === 'github.com' ||
    integration.providerId === 'discord.com'
  const selectedIntegration = providerIntegrations.find(
    (candidate) => installedIntegrationSource(candidate) === source,
  )
  const sourceInstalled = selectedIntegration !== undefined
  const activeIntegration = selectedIntegration ?? integration
  const hasConnections = activeIntegration.connections.length > 0
  const visibleConnections = activeIntegration.connections.filter(
    (connection) => connection.owner === owner,
  )
  const connectedInScope = visibleConnections.length > 0
  const previewQuery = useQuery({
    queryKey: ['executor-tool-preview', entry.providerId, source],
    queryFn: () => previewIntegrationTools({ entry, source }),
    enabled: !sourceInstalled || (selectedIntegration?.tools.length ?? 0) === 0,
    staleTime: 10 * 60_000,
  })

  const selectMethod = (nextMethodId: string) => {
    setMethodId(nextMethodId)
    setValues({})
  }

  const saveCredentials = async () => {
    if (method?.kind !== 'secret') return
    const variables = Array.from(
      new Set(method.placements.map((placement) => placement.variable)),
    )
    if (variables.some((variable) => !values[variable]?.trim())) return
    setSaving(true)
    try {
      await createExecutorConnection({
        integration: integration.slug,
        name: integration.label,
        owner,
        template: method.template,
        values: Object.fromEntries(
          variables.map((variable) => [variable, values[variable] ?? '']),
        ),
      })
      toast.success(`${integration.label} connected`)
      await onConnected()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save credentials',
      )
    } finally {
      setSaving(false)
    }
  }

  let accountSetup: ReactNode = null
  if (nativeProvider && connectedInScope) {
    accountSetup = null
  } else if (nativeProvider) {
    let nativeLabel = 'Connect native app'
    if (integration.providerId === 'github.com')
      nativeLabel = 'Install GitHub App'
    if (integration.providerId === 'discord.com')
      nativeLabel = 'Install Discord Bot'
    accountSetup = (
      <Button
        size="sm"
        disabled={pending}
        onClick={() => onConnect(integration)}
      >
        {nativeLabel}
      </Button>
    )
  } else if (method?.kind === 'none' || integration.authMethods.length === 0) {
    accountSetup = (
      <Button
        size="sm"
        disabled={pending}
        onClick={() => onConnect(integration)}
      >
        Connect to workspace
      </Button>
    )
  } else if (method?.kind === 'secret') {
    const variables = Array.from(
      new Set(method.placements.map((placement) => placement.variable)),
    )
    const credentialsComplete = variables.every((variable) =>
      Boolean(values[variable]?.trim()),
    )
    accountSetup = (
      <div className="space-y-4">
        {variables.map((variable) => {
          const placement = method.placements.find(
            (candidate) => candidate.variable === variable,
          )
          return (
            <label key={variable} className="block space-y-1.5 text-sm">
              <span className="font-medium text-foreground">
                {variable === 'token'
                  ? (placement?.name ?? 'API key')
                  : formatToolName(variable)}
              </span>
              <Input
                type="password"
                value={values[variable] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [variable]: event.target.value,
                  }))
                }
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          )
        })}
        <Button
          size="sm"
          disabled={saving || !credentialsComplete}
          onClick={() => void saveCredentials()}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Connect
        </Button>
      </div>
    )
  } else if (method?.kind === 'oauth') {
    accountSetup = (
      <Button
        size="sm"
        disabled={saving}
        onClick={() => onOAuth(executorOAuthStartUrl(integration.slug, owner))}
      >
        Authorize {integration.label}
      </Button>
    )
  }

  return (
    <>
      <DrawerHeader className="border-b">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <ProviderIcon icon={entry.icon} className="size-5 shrink-0" />
            <DrawerTitle className="truncate">{entry.name}</DrawerTitle>
            <span
              className={`size-2 shrink-0 rounded-full ${statusDotColor(activeIntegration.status)}`}
            />
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              {statusLabelFor(activeIntegration.status)}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {activeIntegration.canRemove ? (
              <IntegrationActionsMenu
                hasConnections={hasConnections}
                canRemove={activeIntegration.canRemove}
                pending={pending || saving}
                onAction={(action) => onAction(activeIntegration.slug, action)}
              />
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              className="size-7 p-0 text-muted-foreground"
              aria-label="Close"
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
        <DrawerDescription>{entry.description}</DrawerDescription>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <span className="rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground uppercase">
            {sourceLabel(source)}
          </span>
          {visibleConnections.map((connection) => (
            <span
              key={connection.address}
              className="rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              {Option.getOrElse(
                connection.identityLabel,
                () => connection.name,
              )}{' '}
              · {connection.owner === 'user' ? 'Personal' : 'Workspace'}
            </span>
          ))}
        </div>
      </DrawerHeader>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <Tabs
          value={source}
          onValueChange={(value) => {
            const decoded = Schema.decodeUnknownOption(
              ExecutorIntegrationSource,
            )(value)
            if (
              Option.isSome(decoded) &&
              entry.sources.includes(decoded.value)
            ) {
              setSource(decoded.value)
            }
          }}
        >
          <TabsList
            variant="line"
            className="max-w-full justify-start overflow-x-auto"
            aria-label="Tool source"
          >
            {entry.sources.map((candidate) => (
              <TabsTrigger key={candidate} value={candidate}>
                {sourceLabel(candidate)}
                {providerIntegrations.some(
                  (providerIntegration) =>
                    installedIntegrationSource(providerIntegration) ===
                    candidate,
                ) ? (
                  <span className="ml-1.5 text-[10px] text-moss">
                    Installed
                  </span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>

          {entry.sources.map((candidate) => (
            <TabsContent key={candidate} value={candidate} className="pt-5">
              <p className="max-w-prose text-sm text-muted-foreground">
                {sourceDescription(candidate)}
              </p>

              {candidate === source &&
              sourceInstalled &&
              selectedIntegration !== undefined ? (
                <>
                  <section className="mt-6">
                    <div className="flex items-baseline justify-between gap-4">
                      <h3 className="text-sm font-semibold text-foreground">
                        Tools
                      </h3>
                      <span className="text-xs text-muted-foreground">
                        {selectedIntegration.tools.length}
                      </span>
                    </div>
                    {selectedIntegration.tools.length > 0 ? (
                      <ToolList tools={selectedIntegration.tools} />
                    ) : previewQuery.isFetching ? (
                      <PreviewToolSkeleton />
                    ) : previewQuery.data?.tools.length ? (
                      <PreviewToolList tools={previewQuery.data.tools} />
                    ) : (
                      <p className="mt-3 text-sm text-muted-foreground">
                        {previewQuery.data?.message ??
                          'Garden could not load tools for this installed source.'}
                      </p>
                    )}
                  </section>

                  {selectedIntegration.slug === integration.slug &&
                  !connectedInScope ? (
                    <section className="mt-8 border-t pt-6">
                      <h3 className="text-sm font-semibold text-foreground">
                        Connect a {owner === 'user' ? 'Personal' : 'Workspace'}{' '}
                        account
                      </h3>
                      {integration.authMethods.length > 1 && !nativeProvider ? (
                        <Tabs
                          value={methodId}
                          onValueChange={(value) => {
                            if (
                              typeof value === 'string' &&
                              integration.authMethods.some(
                                (authMethod) => authMethod.id === value,
                              )
                            ) {
                              selectMethod(value)
                            }
                          }}
                          className="mt-4"
                        >
                          <TabsList variant="line">
                            {integration.authMethods.map((authMethod) => (
                              <TabsTrigger
                                key={authMethod.id}
                                value={authMethod.id}
                              >
                                {authMethod.label}
                              </TabsTrigger>
                            ))}
                          </TabsList>
                          {integration.authMethods.map((authMethod) => (
                            <TabsContent
                              key={authMethod.id}
                              value={authMethod.id}
                              className="pt-4"
                            >
                              {authMethod.id === methodId ? accountSetup : null}
                            </TabsContent>
                          ))}
                        </Tabs>
                      ) : (
                        <div className="mt-4">{accountSetup}</div>
                      )}
                    </section>
                  ) : selectedIntegration.slug !== integration.slug &&
                    !selectedIntegration.connections.some(
                      (connection) => connection.owner === owner,
                    ) ? (
                    <section className="mt-8 border-t pt-6">
                      <Button
                        size="sm"
                        onClick={() =>
                          onManageSource(String(selectedIntegration.slug))
                        }
                      >
                        Set up {sourceLabel(candidate)}
                      </Button>
                    </section>
                  ) : null}
                </>
              ) : candidate === source && !sourceInstalled ? (
                <>
                  <Button
                    className="mt-5"
                    disabled={
                      pending ||
                      previewQuery.data?.status === 'definition_missing'
                    }
                    onClick={() => onInstall(candidate)}
                  >
                    {pending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    {previewQuery.data?.status === 'definition_missing'
                      ? `${sourceLabel(candidate)} definition unavailable`
                      : `Install ${sourceLabel(candidate)}`}
                  </Button>

                  <section className="mt-8 border-t pt-6" aria-live="polite">
                    <div className="flex items-baseline justify-between gap-4">
                      <h3 className="text-sm font-semibold text-foreground">
                        Tools
                      </h3>
                      {Option.isSome(
                        previewQuery.data?.toolCount ?? Option.none(),
                      ) ? (
                        <span className="text-xs text-muted-foreground">
                          {Option.getOrNull(
                            previewQuery.data?.toolCount ?? Option.none(),
                          )}
                        </span>
                      ) : null}
                    </div>
                    {previewQuery.isFetching ? <PreviewToolSkeleton /> : null}
                    {previewQuery.isError ? (
                      <p className="mt-3 text-sm text-muted-foreground">
                        Garden could not load this tool preview. Try again.
                      </p>
                    ) : null}
                    {previewQuery.data && !previewQuery.isFetching ? (
                      previewQuery.data.tools.length > 0 ? (
                        <PreviewToolList tools={previewQuery.data.tools} />
                      ) : (
                        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
                          {previewQuery.data.message}
                        </p>
                      )
                    ) : null}
                  </section>
                </>
              ) : null}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </>
  )
}

function IntegrationActionsMenu({
  hasConnections,
  canRemove,
  pending,
  onAction,
}: {
  hasConnections: boolean
  canRemove: boolean
  pending: boolean
  onAction: (action: IntegrationAction) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="size-7 p-0 text-muted-foreground"
            aria-label="More actions"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-44">
        {hasConnections && (
          <>
            <DropdownMenuItem
              onClick={() => onAction('resync')}
              disabled={pending}
            >
              Resync tools
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onAction('disconnect')}
              disabled={pending}
            >
              Disconnect
            </DropdownMenuItem>
          </>
        )}
        {canRemove && (
          <>
            {hasConnections && <DropdownMenuSeparator />}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onAction('delete')}
              disabled={pending}
            >
              Delete integration
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PreviewToolList({
  tools,
}: {
  tools: readonly ExecutorToolPreviewItem[]
}) {
  return (
    <ul className="mt-3 divide-y divide-border/40">
      {tools.map((tool, index) => (
        <li key={`${tool.name}:${index}`} className="py-2.5">
          <span className="block text-sm font-medium text-foreground">
            {formatToolName(tool.name)}
          </span>
          {tool.description ? (
            <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
              {tool.description}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function PreviewToolSkeleton() {
  return (
    <div className="mt-3 space-y-3" aria-label="Loading tool preview">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="space-y-1.5 py-1">
          <div className="h-4 w-40 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted/70 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  )
}

function ToolList({ tools }: { tools: readonly ExecutorIntegrationTool[] }) {
  return (
    <ul className="mt-3">
      {tools.map((tool) => (
        <li
          key={tool.address}
          className="flex items-center justify-between gap-4 border-b border-border/40 py-2.5 last:border-b-0"
        >
          <span className="min-w-0 flex-1">
            <span
              className="block truncate text-sm text-foreground"
              title={tool.description || tool.name}
            >
              {formatToolName(tool.name)}
            </span>
            {tool.description ? (
              <span className="block truncate text-xs text-muted-foreground">
                {tool.description}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

function FeaturedSkeleton() {
  return (
    <div
      className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2"
      aria-hidden="true"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="h-36 animate-pulse rounded-xl border border-border/40 bg-muted/20"
        />
      ))}
    </div>
  )
}
