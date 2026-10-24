import { useState, type ReactNode } from 'react'
import { Option, Schema } from 'effect'
import { useQuery } from '@tanstack/react-query'
import { MoreHorizontal, X } from 'lucide-react'
import { toast } from 'sonner'
import { type IntegrationAction } from '@/lib/api'
import {
  createExecutorConnection,
  executorOAuthStartUrl,
  previewIntegrationTools,
  type RegistryEntry,
} from '@/lib/api/executor'
import {
  type ExecutorConnectionOwner,
  type ExecutorIntegrationItem,
  ExecutorIntegrationSource,
} from '@/lib/executor-contract'
import { executorRegistryKeys } from '../queries'
import { Button } from '@garden/ui/components/ui/button'
import { ConfirmDialog } from '@garden/ui/components/common/confirm-dialog'
import { Input } from '@garden/ui/components/ui/input'
import {
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
import { Spinner } from '@garden/ui/components/ui/spinner'
import {
  statusDotColor,
  statusLabelFor,
  formatToolName,
  installedIntegrationSource,
  sourceLabel,
  sourceDescription,
} from './connection-helpers'
import { ProviderIcon } from './provider-icon'
import { PreviewToolList, PreviewToolSkeleton, ToolList } from './tool-list'

export function ManageDrawerBody({
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
  const githubNeedsRepair =
    activeIntegration.providerId === 'github.com' &&
    activeIntegration.status === 'degraded'
  const previewQuery = useQuery({
    queryKey: executorRegistryKeys.toolPreview(entry.providerId, source),
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
          {saving ? <Spinner aria-hidden="true" /> : null}
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
                label={activeIntegration.label}
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
        {githubNeedsRepair ? (
          <section className="mb-5 rounded-lg border border-border-warning-tertiary/30 bg-background-warning-default/8 p-4">
            <h3 className="text-sm font-semibold text-foreground">
              GitHub installation needs repair
            </h3>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              Reconnect the GitHub App to replace the stale installation without
              changing repository access.
            </p>
            <Button
              className="mt-3"
              size="sm"
              disabled={pending}
              onClick={() => onConnect(activeIntegration)}
            >
              Repair GitHub App
            </Button>
          </section>
        ) : null}
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
                  <span className="ml-1.5 text-[10px] text-success">
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
                    {pending ? <Spinner aria-hidden="true" /> : null}
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

export function IntegrationActionsMenu({
  label,
  hasConnections,
  canRemove,
  pending,
  onAction,
}: {
  label: string
  hasConnections: boolean
  canRemove: boolean
  pending: boolean
  onAction: (action: IntegrationAction) => void
}) {
  // Disconnect and Delete used to run on the first click of the menu item.
  const [confirmAction, setConfirmAction] = useState<
    'disconnect' | 'delete' | null
  >(null)

  return (
    <>
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
                onClick={() => setConfirmAction('disconnect')}
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
                onClick={() => setConfirmAction('delete')}
                disabled={pending}
              >
                Delete integration
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null)
        }}
        title={
          confirmAction === 'delete'
            ? `Delete the ${label} integration?`
            : `Disconnect ${label}?`
        }
        description={
          confirmAction === 'delete'
            ? 'This removes the integration and its connections from the workspace.'
            : 'Garden stops using these credentials. You can connect again later.'
        }
        confirmLabel={confirmAction === 'delete' ? 'Delete' : 'Disconnect'}
        tone="destructive"
        onConfirm={() => {
          if (confirmAction) onAction(confirmAction)
        }}
      />
    </>
  )
}
