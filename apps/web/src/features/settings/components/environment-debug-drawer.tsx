'use client'

import { useMemo, useState } from 'react'
import { Result } from 'better-result'
import {
  Bug,
  Check,
  ChevronRight,
  Cloud,
  Copy,
  FileText,
  HardDrive,
  MessagesSquare,
  Plug,
  Radio,
  RefreshCw,
  Server,
  Terminal as TerminalIcon,
  Wrench,
} from 'lucide-react'
import { useWorkspaceStore } from '@garden/core/workspace'
import { Alert, AlertDescription } from '@garden/ui/components/ui/alert'
import { Badge } from '@garden/ui/components/ui/badge'
import { Button } from '@garden/ui/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@garden/ui/components/ui/collapsible'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@garden/ui/components/ui/drawer'
import { cn } from '@garden/ui/lib/utils'
import {
  DEBUG_SDK_STACK,
  VIRTUAL_FS_BACKING_STORES,
  type DebugMetaPayload,
  type DebugPromptPayload,
  type DebugSandboxPayload,
  type DebugToolsPayload,
  type DebugWorkspacePayload,
  type ToolGroup,
  type ToolInventoryEntry,
  type WorkspaceStateEntry,
} from '@/lib/environment-debug'
import { useAgentSessions } from '@/features/chat/use-agent-chat-sessions'
import {
  refreshDebugPrompt,
  useDebugStream,
  type DebugSection,
} from './use-debug-stream'

// ---------- primitives ----------

function Panel({
  icon,
  title,
  right,
  loading,
  error,
  empty,
  children,
}: {
  icon: React.ReactNode
  title: string
  right?: React.ReactNode
  loading?: boolean
  error?: string
  empty?: boolean
  children?: React.ReactNode
}) {
  return (
    <section className="border-b">
      <header className="flex items-center justify-between gap-2 px-1 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="text-muted-foreground">{icon}</span>
          <span>{title}</span>
          {loading ? <LiveDot /> : null}
        </div>
        {right ? <div className="flex items-center gap-1">{right}</div> : null}
      </header>
      <div className="pb-3">
        {error ? <SectionError message={error} /> : null}
        {loading && !children ? (
          <SkeletonRows />
        ) : empty ? (
          <div className="text-xs text-muted-foreground">Nothing to show.</div>
        ) : (
          children
        )}
      </div>
    </section>
  )
}

function LiveDot() {
  return (
    <span className="relative inline-flex size-1.5" aria-hidden>
      <span className="absolute inline-flex size-1.5 animate-ping rounded-full bg-sky-400 opacity-75" />
      <span className="relative inline-flex size-1.5 rounded-full bg-sky-500" />
    </span>
  )
}

function SkeletonRows({ rows = 2 }: { rows?: number }) {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-4 animate-pulse rounded bg-muted/60"
          style={{ width: `${60 + ((i * 17) % 35)}%` }}
        />
      ))}
    </div>
  )
}

function CopyValue({
  value,
  label = 'Copy',
}: {
  value: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-colors group-hover/copy:opacity-100 hover:bg-muted hover:text-foreground focus:opacity-100"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 900)
          },
          () => setCopied(false),
        )
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  )
}

function KV({
  k,
  v,
  copyValue,
}: {
  k: string
  v: React.ReactNode
  copyValue?: string | null
}) {
  return (
    <div className="group/copy flex items-baseline justify-between gap-3 border-b py-1 text-xs last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="flex min-w-0 items-center justify-end gap-1 text-right font-mono text-foreground">
        <span className="truncate">{v}</span>
        {copyValue ? (
          <CopyValue value={copyValue} label={`Copy ${k}`} />
        ) : null}
      </span>
    </div>
  )
}

function SectionError({ message }: { message: string }) {
  return (
    <Alert
      variant="destructive"
      className="mb-2 border-destructive/30 bg-destructive/5 px-2 py-1.5"
    >
      <AlertDescription className="text-xs text-destructive">
        {message}
      </AlertDescription>
    </Alert>
  )
}

function Terminal({ body }: { body: string | null | undefined }) {
  return (
    <pre className="max-h-56 overflow-auto rounded-md border bg-muted/30 p-2 text-[11px] leading-4 whitespace-pre-wrap text-foreground">
      {body?.trim() || '—'}
    </pre>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

// ---------- tools ----------

const GROUP_ORDER: ToolGroup[] = [
  'workspace',
  'custom',
  'session',
  'extension',
]

const GROUP_LABEL: Record<ToolGroup, string> = {
  workspace: 'Workspace',
  custom: 'Custom',
  session: 'Session',
  extension: 'Extensions',
  mcp: 'MCP',
}

const GROUP_DESC: Record<ToolGroup, string> = {
  workspace:
    'createWorkspaceTools(workspace): read/write/edit/list/find/grep/delete',
  custom: 'Agent getTools()',
  session: 'session.tools(): set_context / load_context',
  extension: 'Loaded sandboxed extension workers',
  mcp: 'Connector MCP tools, rendered in the connector section below',
}

function ToolsPanel({
  tools,
  loading,
  error,
}: {
  tools: DebugToolsPayload | null
  loading: boolean
  error?: string
}) {
  const grouped = useMemo(() => {
    const map = new Map<ToolGroup, ToolInventoryEntry[]>()
    for (const t of tools?.inventory ?? []) {
      const arr = map.get(t.group) ?? []
      arr.push(t)
      map.set(t.group, arr)
    }
    return map
  }, [tools])

  const counts = tools?.counts
  const connectorCapabilities = tools?.connectorCapabilities ?? []
  const exposedConnectorToolCount = connectorCapabilities.reduce(
    (count, connector) =>
      count + connector.tools.filter((tool) => tool.exposed).length,
    0,
  )
  const visibleLlmToolCount = counts ? counts.total - counts.mcp : 0

  return (
    <Panel
      icon={<Wrench className="size-3.5" />}
      title="Tools"
      loading={loading}
      error={error}
      right={
        counts ? (
          <Badge variant="secondary" className="text-[10px]">
            {visibleLlmToolCount} local · {exposedConnectorToolCount}{' '}
            connector · {counts.rpc} RPC
          </Badge>
        ) : null
      }
    >
      {tools ? (
        <div className="space-y-3">
          {GROUP_ORDER.map((group) => {
            const entries = grouped.get(group)
            if (!entries || entries.length === 0) return null
            return (
              <div key={group}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <div className="text-xs font-medium">
                    {GROUP_LABEL[group]}{' '}
                    <span className="text-muted-foreground">
                      · {entries.length}
                    </span>
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {GROUP_DESC[group]}
                  </div>
                </div>
                <ul>
                  {entries.map((entry) => (
                    <li
                      key={`${entry.group}:${entry.key}`}
                      className="border-t py-1.5 first:border-t-0"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="group/copy flex items-center gap-1.5">
                            <span className="font-mono text-xs text-foreground">
                              {entry.key}
                            </span>
                            <CopyValue
                              value={entry.key}
                              label={`Copy ${entry.key}`}
                            />
                            {entry.source ? (
                              <span className="text-[10px] text-muted-foreground">
                                ({entry.source})
                              </span>
                            ) : null}
                          </div>
                          {entry.description ? (
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              {entry.description}
                            </div>
                          ) : null}
                          {entry.inputKeys.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {entry.inputKeys.map((k) => (
                                <span
                                  key={k}
                                  className="rounded-sm bg-muted/60 px-1 font-mono text-[10px] text-muted-foreground"
                                >
                                  {k}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        {!entry.hasExecute ? (
                          <Badge
                            variant="outline"
                            className="shrink-0 text-[10px]"
                            title="Tool has no execute() — decorative only"
                          >
                            no exec
                          </Badge>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}

          {connectorCapabilities.length > 0 ? (
            <div>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Plug className="size-3 text-muted-foreground" />
                  Connector MCP{' '}
                  <span className="text-muted-foreground">
                    · {connectorCapabilities.length}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Exposed tools + permission catalog
                </div>
              </div>
              <div>
                {connectorCapabilities.map((connector) => (
                  <div
                    key={connector.id}
                    className="border-t py-2 first:border-t-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="group/copy flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-xs font-medium">
                          {connector.label}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {connector.id}
                        </span>
                        <CopyValue
                          value={connector.id}
                          label={`Copy ${connector.label} connector id`}
                        />
                      </div>
                      <Badge
                        variant={
                          connector.connected ? 'secondary' : 'outline'
                        }
                        className="shrink-0 text-[10px]"
                      >
                        {connector.exposed
                          ? 'exposed'
                          : (connector.status ??
                            (connector.connected ? 'connected' : 'catalog'))}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {connector.tools.map((tool) => (
                        <span
                          key={`${connector.id}:${tool.name}`}
                          className="group/copy inline-flex max-w-full items-center gap-1 rounded-sm bg-muted/50 px-1.5 py-0.5 text-[10px]"
                          title={tool.description ?? undefined}
                        >
                          <span className="truncate font-mono">
                            {tool.name}
                          </span>
                          <span className="text-muted-foreground">
                            {tool.riskClass}
                            {tool.trustLevel ? `/${tool.trustLevel}` : ''}
                            {tool.exposed ? '/exposed' : ''}
                          </span>
                          {tool.runtimeKey ? (
                            <CopyValue
                              value={tool.runtimeKey}
                              label={`Copy ${tool.runtimeKey}`}
                            />
                          ) : null}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {tools.extensions.length > 0 ? (
            <div>
              <div className="mb-1.5 text-xs font-medium">
                Loaded extensions{' '}
                <span className="text-muted-foreground">
                  · {tools.extensions.length}
                </span>
              </div>
              <ul>
                {tools.extensions.map((ext) => (
                  <li
                    key={ext.name}
                    className="border-t py-1.5 text-xs first:border-t-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono">
                        {ext.name}@{ext.version}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {ext.tools.length} tools · {ext.contextLabels.length}{' '}
                        ctx
                      </span>
                    </div>
                    {ext.description ? (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {ext.description}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <div className="text-xs font-medium">
                @callable RPC{' '}
                <span className="text-muted-foreground">
                  · {tools.rpcMethods.length}
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                From agent.getCallableMethods()
              </div>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2">
              {tools.rpcMethods.map((m) => (
                <li
                  key={m.name}
                  className="border-t py-1 text-xs sm:px-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono">{m.name}</span>
                    {m.streaming ? (
                      <Badge variant="outline" className="text-[10px]">
                        stream
                      </Badge>
                    ) : null}
                  </div>
                  {m.description ? (
                    <div className="text-[10px] text-muted-foreground">
                      {m.description}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </Panel>
  )
}

// ---------- entries ----------

function EntryList({ entries }: { entries: WorkspaceStateEntry[] }) {
  if (entries.length === 0) {
    return <div className="text-xs text-muted-foreground">No entries.</div>
  }
  return (
    <ul>
      {entries.map((entry) => (
        <li
          key={entry.path}
          className="flex items-center justify-between gap-3 border-t py-1 first:border-t-0"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-xs text-foreground">
              {entry.path}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {entry.type} · {formatBytes(entry.size)} · {entry.mimeType}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

// ---------- main ----------

interface EnvironmentDebugDrawerProps {
  sessionId: string | null
  label?: string
}

export function EnvironmentDebugDrawer({
  sessionId,
  label = 'Agent debug',
}: EnvironmentDebugDrawerProps) {
  const [open, setOpen] = useState(false)
  const [refreshingPrompt, setRefreshingPrompt] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const workspaceId = useWorkspaceStore((state) => state.workspace?.id ?? null)
  const { sessions: uiSessions } = useAgentSessions()

  const state = useDebugStream({ open, workspaceId, sessionId })

  const activeUiStatus = useMemo(() => {
    if (!sessionId) return null
    return uiSessions.find((s) => s.id === sessionId)?.status ?? null
  }, [uiSessions, sessionId])

  const activeUiSession = useMemo(
    () => uiSessions.find((s) => s.id === sessionId) ?? null,
    [uiSessions, sessionId],
  )

  const loading = (k: DebugSection) => state.pending.has(k)

  const handleRefreshPrompt = async () => {
    setRefreshingPrompt(true)
    setRefreshError(null)
    const result = await Result.tryPromise({
      try: async () => await refreshDebugPrompt(workspaceId, sessionId),
      catch: (cause) =>
        cause instanceof Error ? cause.message : String(cause),
    })
    if (result.isErr()) setRefreshError(result.error)
    setRefreshingPrompt(false)
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
      >
        <Bug className="size-4" />
      </Button>

      <Drawer open={open} onOpenChange={setOpen} direction="right">
        <DrawerContent className="data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-2xl">
          <DrawerHeader className="border-b">
            <div className="flex items-center gap-2">
              <DrawerTitle>Agent debug</DrawerTitle>
              {!state.done && state.openAt ? <LiveDot /> : null}
            </div>
            <DrawerDescription>
              Warmed from the chat tab; sections update as the debug stream
              resolves.
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto">
            {!workspaceId ? (
              <EmptyState title="No workspace selected" />
            ) : !sessionId ? (
              <EmptyState title="No active chat" />
            ) : state.fatal ? (
              <div className="p-4">
                <SectionError message={state.fatal} />
              </div>
            ) : (
              <div className="px-4 pb-4">
                <StatusStrip
                  meta={state.meta}
                  sandbox={state.sandbox}
                  tools={state.tools}
                  uiStatus={activeUiStatus}
                  generatedAt={state.openAt}
                />

                {activeUiStatus === 'error' ? (
                  <Panel
                    icon={<Server className="size-3.5" />}
                    title="Current UI error"
                  >
                    <Terminal
                      body={
                        activeUiSession?.lastMessage || 'No error captured.'
                      }
                    />
                  </Panel>
                ) : null}

                <ToolsPanel
                  tools={state.tools}
                  loading={loading('tools')}
                  error={state.errors.tools}
                />

                <PromptPanel
                  prompt={state.prompt}
                  loading={loading('prompt') || refreshingPrompt}
                  error={refreshError ?? state.errors.prompt}
                  onRefreshPrompt={handleRefreshPrompt}
                  canRefresh={Boolean(workspaceId && sessionId)}
                  refreshing={refreshingPrompt}
                />

                <SessionsPanel
                  meta={state.meta}
                  loading={loading('meta')}
                  error={state.errors.meta}
                />

                <WorkspacePanel
                  workspace={state.workspace}
                  loading={loading('workspace')}
                  error={state.errors.workspace}
                />

                <SandboxPanel
                  sandbox={state.sandbox}
                  loading={loading('sandbox')}
                  error={state.errors.sandbox}
                />

                <SdkStrip />
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center p-6 text-sm text-muted-foreground">
      {title}
    </div>
  )
}

function StatusStrip({
  meta,
  sandbox,
  tools,
  uiStatus,
  generatedAt,
}: {
  meta: DebugMetaPayload | null
  sandbox: DebugSandboxPayload | null
  tools: DebugToolsPayload | null
  uiStatus: string | null
  generatedAt: string | null
}) {
  return (
    <div className="border-b py-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatusCell
          label="UI"
          value={uiStatus ?? 'idle'}
          tone={uiStatus === 'error' ? 'danger' : 'default'}
        />
        <StatusCell label="Messages" value={meta?.currentMessageCount ?? '—'} />
        <StatusCell
          label="Sandbox"
          value={
            sandbox
              ? sandbox.reachable
                ? (sandbox.pingMessage ?? 'live')
                : 'offline'
              : '…'
          }
          tone={sandbox && !sandbox.reachable ? 'danger' : 'default'}
        />
        <StatusCell
          label="Tools"
          value={
            tools?.counts ? `${tools.counts.total}+${tools.counts.rpc}` : '…'
          }
          hint="LLM tools + callable RPC"
        />
      </div>
      {meta ? (
        <div className="mt-2 space-y-0 border-t pt-2">
          <KV k="runtime path" v={meta.agentName} copyValue={meta.agentName} />
          <KV
            k="thread id"
            v={meta.effectiveSessionId}
            copyValue={meta.effectiveSessionId}
          />
          {generatedAt ? (
            <KV k="generated" v={new Date(generatedAt).toLocaleTimeString()} />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function StatusCell({
  label,
  value,
  tone = 'default',
  hint,
}: {
  label: string
  value: React.ReactNode
  tone?: 'default' | 'danger'
  hint?: string
}) {
  return (
    <div
      className={cn(
        'border-l px-2 py-1',
        tone === 'danger' && 'border-destructive/30 text-destructive',
      )}
      title={hint}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="truncate text-sm font-medium">{value}</div>
    </div>
  )
}

// ---------- prompt panel ----------

function PromptPanel({
  prompt,
  loading,
  error,
  onRefreshPrompt,
  canRefresh,
  refreshing,
}: {
  prompt: DebugPromptPayload | null
  loading: boolean
  error?: string
  onRefreshPrompt: () => void
  canRefresh: boolean
  refreshing: boolean
}) {
  const [openPrompt, setOpenPrompt] = useState(false)
  return (
    <Panel
      icon={<FileText className="size-3.5" />}
      title="System prompt"
      loading={loading}
      error={error}
      right={
        <>
          {prompt ? (
            <Badge variant="outline" className="text-[10px]">
              {prompt.charCount} chars · {prompt.lineCount} lines
            </Badge>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRefreshPrompt}
            disabled={!canRefresh || refreshing}
            aria-label="Refresh system prompt"
            title="Refresh system prompt"
          >
            <RefreshCw
              className={cn('size-3.5', refreshing && 'animate-spin')}
            />
          </Button>
        </>
      }
    >
      {prompt ? (
        <div className="space-y-2">
          {prompt.contextBlocks.length > 0 ? (
            <div>
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                Context blocks ({prompt.contextBlocks.length})
              </div>
              <ul className="space-y-1">
                {prompt.contextBlocks.map((block) => (
                  <li
                    key={block.label}
                    className="rounded-md border px-2 py-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono">{block.label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {block.contentLength} chars
                        {block.truncated ? ' · truncated' : ''}
                      </span>
                    </div>
                    {block.preview ? (
                      <pre className="mt-1 max-h-24 overflow-auto rounded bg-muted/30 p-1 text-[10px] leading-3 whitespace-pre-wrap">
                        {block.preview}
                      </pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {prompt.loadedSkillKeys.length > 0 ? (
            <div>
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                Loaded skills ({prompt.loadedSkillKeys.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {prompt.loadedSkillKeys.map((key) => (
                  <Badge
                    key={key}
                    variant="secondary"
                    className="font-mono text-[10px]"
                  >
                    {key}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          <Collapsible open={openPrompt} onOpenChange={setOpenPrompt}>
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1 text-left text-[11px] hover:bg-muted/20">
              <span className="flex items-center gap-2">
                <ChevronRight
                  className={cn(
                    'size-3 transition-transform',
                    openPrompt && 'rotate-90',
                  )}
                />
                <span className="font-medium">Frozen system prompt</span>
              </span>
              <span className="text-muted-foreground">
                {prompt.charCount} chars
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Terminal body={prompt.prompt} />
            </CollapsibleContent>
          </Collapsible>
        </div>
      ) : null}
    </Panel>
  )
}

// ---------- sessions panel ----------

function SessionsPanel({
  meta,
  loading,
  error,
}: {
  meta: DebugMetaPayload | null
  loading: boolean
  error?: string
}) {
  return (
    <Panel
      icon={<MessagesSquare className="size-3.5" />}
      title="Sessions"
      loading={loading}
      error={error}
      right={
        meta ? (
          <Badge variant="outline" className="text-[10px]">
            {meta.visibleSessionCount}
          </Badge>
        ) : null
      }
    >
      {meta ? (
        meta.sessions.length === 0 ? (
          <div className="text-xs text-muted-foreground">No sessions.</div>
        ) : (
          <ul className="space-y-1">
            {meta.sessions.map((session) => (
              <li key={session.id} className="rounded-md border px-2 py-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">
                      {session.title}
                    </div>
                    <div className="group/copy flex min-w-0 items-center gap-1 font-mono text-[10px] text-muted-foreground">
                      <span className="truncate">{session.id}</span>
                      <CopyValue
                        value={session.id}
                        label={`Copy ${session.title} id`}
                      />
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {session.lastMessage || '—'}
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {session.messageCount} msgs
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </Panel>
  )
}

// ---------- workspace panel ----------

function WorkspacePanel({
  workspace,
  loading,
  error,
}: {
  workspace: DebugWorkspacePayload | null
  loading: boolean
  error?: string
}) {
  return (
    <Panel
      icon={<HardDrive className="size-3.5" />}
      title="Virtual filesystem"
      loading={loading}
      error={error}
      right={
        workspace?.stats ? (
          <Badge variant="outline" className="text-[10px]">
            {workspace.stats.fileCount} files ·{' '}
            {formatBytes(workspace.stats.totalBytes)}
          </Badge>
        ) : null
      }
    >
      {workspace ? (
        <div className="space-y-2">
          {workspace.stats ? (
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
              <StatusCell label="Files" value={workspace.stats.fileCount} />
              <StatusCell label="Dirs" value={workspace.stats.directoryCount} />
              <StatusCell
                label="Total"
                value={formatBytes(workspace.stats.totalBytes)}
              />
              <StatusCell label="R2" value={workspace.stats.r2FileCount} />
            </div>
          ) : null}

          <div className="flex flex-wrap gap-1">
            {VIRTUAL_FS_BACKING_STORES.map((store) => (
              <Badge key={store} variant="outline" className="text-[10px]">
                {store}
              </Badge>
            ))}
          </div>
          <div>
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">
              Root ({workspace.rootEntries.length})
            </div>
            <EntryList entries={workspace.rootEntries} />
          </div>
          {workspace.samplePathCount > workspace.samplePaths.length ? (
            <div className="text-[10px] text-muted-foreground">
              Showing {workspace.samplePaths.length} of{' '}
              {workspace.samplePathCount} matched paths
            </div>
          ) : null}
          {workspace.samplePaths.length > 0 ? (
            <div>
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                Sample paths ({workspace.samplePaths.length})
              </div>
              <EntryList entries={workspace.samplePaths} />
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}

// ---------- sandbox panel ----------

function SandboxPanel({
  sandbox,
  loading,
  error,
}: {
  sandbox: DebugSandboxPayload | null
  loading: boolean
  error?: string
}) {
  const [openCmds, setOpenCmds] = useState(false)
  return (
    <Panel
      icon={<Cloud className="size-3.5" />}
      title="Sandbox"
      loading={loading}
      error={error}
      right={
        sandbox ? (
          <Badge
            variant={sandbox.reachable ? 'secondary' : 'outline'}
            className="text-[10px]"
          >
            <Radio className="mr-1 size-2.5" />
            {sandbox.reachable ? 'live' : 'offline'}
          </Badge>
        ) : null
      }
    >
      {sandbox ? (
        <div className="space-y-2">
          <div className="space-y-0">
            <KV k="sandbox id" v={sandbox.id} copyValue={sandbox.id} />
            <KV
              k="placement"
              v={sandbox.containerPlacementId ?? '—'}
              copyValue={sandbox.containerPlacementId}
            />
            <KV k="cwd" v={sandbox.cwd ?? '—'} />
            <KV k="ping" v={sandbox.pingMessage ?? '—'} />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-[11px] font-medium text-muted-foreground">
                Processes ({sandbox.processes.length})
              </div>
              {sandbox.processError ? (
                <Badge
                  variant="outline"
                  className="text-[10px] text-destructive"
                  title={sandbox.processError}
                >
                  listProcesses failed
                </Badge>
              ) : null}
            </div>
            {sandbox.processes.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                No running processes.
              </div>
            ) : (
              <ul className="space-y-1">
                {sandbox.processes.map((proc) => (
                  <li
                    key={proc.id || proc.command}
                    className="rounded-md border px-2 py-1 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono">
                        {proc.command || proc.id}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {proc.status}
                      </Badge>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {proc.pid !== null ? `pid ${proc.pid}` : ''}
                      {proc.startTime
                        ? ` · ${new Date(proc.startTime).toLocaleTimeString()}`
                        : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <TerminalIcon className="size-3" />
              /workspace
            </div>
            <Terminal body={sandbox.workspaceListing} />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <TerminalIcon className="size-3" />
              cwd listing
            </div>
            <Terminal body={sandbox.currentDirectoryListing} />
          </div>

          {sandbox.availableCommands ? (
            <Collapsible open={openCmds} onOpenChange={setOpenCmds}>
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1 text-left text-[11px] hover:bg-muted/20">
                <span className="flex items-center gap-2">
                  <ChevronRight
                    className={cn(
                      'size-3 transition-transform',
                      openCmds && 'rotate-90',
                    )}
                  />
                  <span className="font-medium">Available commands</span>
                </span>
                <span className="text-muted-foreground">
                  {sandbox.availableCommands.length}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-1 flex flex-wrap gap-1 rounded-md border bg-muted/20 p-1.5">
                  {sandbox.availableCommands.map((cmd) => (
                    <span
                      key={cmd}
                      className="rounded-sm bg-background px-1 font-mono text-[10px]"
                    >
                      {cmd}
                    </span>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ) : sandbox.commandsError ? (
            <div className="text-[10px] text-muted-foreground">
              Sandbox utils.getCommands unavailable: {sandbox.commandsError}
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}

// ---------- sdk strip ----------

function SdkStrip() {
  const [open, setOpen] = useState(false)
  const headline = DEBUG_SDK_STACK.slice(0, 3)
    .map((s) => `${s.name}@${s.version}`)
    .join(' · ')
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-lg border bg-muted/10 px-3 py-2 text-left text-xs hover:bg-muted/20">
        <span className="flex items-center gap-2">
          <ChevronRight
            className={cn('size-3 transition-transform', open && 'rotate-90')}
          />
          <span className="font-medium">SDK stack</span>
          <span className="text-muted-foreground">
            {DEBUG_SDK_STACK.length} · {headline}
            {DEBUG_SDK_STACK.length > 3 ? ' …' : ''}
          </span>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 grid grid-cols-1 gap-1 rounded-lg border bg-card p-2 sm:grid-cols-2">
          {DEBUG_SDK_STACK.map((sdk) => (
            <div
              key={sdk.name}
              className="rounded-md border px-2 py-1 text-[11px]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono">{sdk.name}</span>
                <span className="text-muted-foreground">{sdk.version}</span>
              </div>
              <div className="truncate text-[10px] text-muted-foreground">
                {sdk.role}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
