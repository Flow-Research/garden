'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bug,
  Cloud,
  Database,
  HardDrive,
  LoaderCircle,
  MessagesSquare,
  Server,
  Wrench,
} from 'lucide-react'
import { useWorkspaceStore } from '@garden/core/workspace'
import { Badge } from '@garden/ui/components/ui/badge'
import { Button } from '@garden/ui/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@garden/ui/components/ui/card'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@garden/ui/components/ui/drawer'
import type {
  EnvironmentDebugSnapshot,
  SdkVersionInfo,
  WorkspaceStateEntry,
} from '@/lib/environment-debug'
import { useAgentSessions } from '@/features/chat/use-agent-chat-sessions'

async function loadRuntimeStateSnapshot({
  workspaceId,
  sessionId,
}: {
  workspaceId: string
  sessionId: string | null
}) {
  if (!workspaceId || !sessionId) {
    return null
  }

  const url = new URL('/api/config', window.location.origin)
  url.searchParams.set('workspace_id', workspaceId)
  url.searchParams.set('session_id', sessionId)

  const response = await fetch(url.toString(), {
    credentials: 'include',
  })

  if (response.status === 204) {
    return null
  }

  if (!response.ok) {
    throw new Error('Failed to load agent runtime state')
  }

  return (await response.json()) as EnvironmentDebugSnapshot
}

function StatusBadge({ available }: { available: boolean }) {
  return (
    <Badge variant={available ? 'secondary' : 'outline'}>
      {available ? 'live' : 'inactive'}
    </Badge>
  )
}

function WorkspaceEntryList({
  title,
  description,
  entries,
}: {
  title: string
  description: string
  entries: WorkspaceStateEntry[]
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {entries.length === 0 ? (
          <div className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
            No entries yet.
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.path}
              className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2"
            >
              <div className="min-w-0 space-y-1">
                <div className="font-medium text-foreground">{entry.path}</div>
                <div className="text-sm text-muted-foreground">
                  {entry.type} · {entry.size} bytes · {entry.mimeType}
                </div>
              </div>
              <Badge variant="outline">{entry.type}</Badge>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function SdkCard({ sdk }: { sdk: SdkVersionInfo }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-foreground">{sdk.name}</div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{sdk.channel}</Badge>
          <Badge variant="secondary">{sdk.version}</Badge>
        </div>
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{sdk.role}</div>
    </div>
  )
}

function TerminalBlock({
  title,
  body,
}: {
  title: string
  body: string | null | undefined
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs leading-5 whitespace-pre-wrap text-foreground">
          {body?.trim() || 'No output.'}
        </pre>
      </CardContent>
    </Card>
  )
}

interface EnvironmentDebugDrawerProps {
  /** Session id this drawer should inspect. */
  sessionId: string | null
  /** Optional button label (defaults to "Agent State"). */
  label?: string
}

export function EnvironmentDebugDrawer({
  sessionId,
  label = 'Agent State',
}: EnvironmentDebugDrawerProps) {
  const [open, setOpen] = useState(false)
  const workspaceId = useWorkspaceStore((state) => state.workspace?.id ?? null)
  const { sessions: uiSessions } = useAgentSessions()

  const queryKey = useMemo(
    () => ['agent-runtime-state', workspaceId, sessionId],
    [workspaceId, sessionId],
  )

  const snapshotQuery = useQuery({
    queryKey,
    queryFn: () =>
      loadRuntimeStateSnapshot({
        workspaceId: workspaceId as string,
        sessionId,
      }),
    enabled: open && !!workspaceId && !!sessionId,
    staleTime: 15_000,
  })

  const snapshot = snapshotQuery.data ?? null
  const sessionStatusMap = useMemo(
    () => new Map(uiSessions.map((session) => [session.id, session.status])),
    [uiSessions],
  )
  const activeUiStatus =
    (sessionId ? sessionStatusMap.get(sessionId) : null) ?? null
  const activeUiSession =
    uiSessions.find((session) => session.id === sessionId) ?? null

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
        <DrawerContent className="data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-4xl">
          <DrawerHeader className="border-b">
            <DrawerTitle>Live Agent State</DrawerTitle>
            <DrawerDescription>
              Actual Durable Object, session, virtual filesystem, and sandbox
              state for the current workspace.
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto p-4">
            {!workspaceId ? (
              <Card>
                <CardHeader>
                  <CardTitle>No workspace selected</CardTitle>
                  <CardDescription>
                    Open a workspace first so the panel can query its live
                    agent object.
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : null}

            {workspaceId && !sessionId ? (
              <Card>
                <CardHeader>
                  <CardTitle>No active chat selected</CardTitle>
                  <CardDescription>
                    Open a chat thread first so the panel can query its live
                    agent object.
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : null}

            {snapshotQuery.isLoading ? (
              <div className="flex min-h-40 items-center justify-center gap-2 text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Loading live agent state
              </div>
            ) : null}

            {snapshotQuery.isError ? (
              <Card>
                <CardHeader>
                  <CardTitle>State unavailable</CardTitle>
                  <CardDescription>
                    {snapshotQuery.error instanceof Error
                      ? snapshotQuery.error.message
                      : 'Failed to load live agent state.'}
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : null}

            {snapshot ? (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Server className="size-4" />
                      Durable object
                    </CardTitle>
                    <CardDescription>
                      Snapshot generated {new Date(snapshot.generatedAt).toLocaleString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg border px-3 py-2">
                      <div className="text-xs text-muted-foreground">
                        Workspace
                      </div>
                      <div className="font-medium">{snapshot.workspaceId}</div>
                    </div>
                    <div className="rounded-lg border px-3 py-2">
                      <div className="text-xs text-muted-foreground">
                        Agent object
                      </div>
                      <div className="font-medium">{snapshot.agent.name}</div>
                    </div>
                    <div className="rounded-lg border px-3 py-2">
                      <div className="text-xs text-muted-foreground">
                        Effective session
                      </div>
                      <div className="font-medium">
                        {snapshot.agent.effectiveSessionId}
                      </div>
                    </div>
                    <div className="rounded-lg border px-3 py-2">
                      <div className="text-xs text-muted-foreground">
                        Agent status
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant="secondary">
                          {activeUiStatus ?? 'unknown'}
                        </Badge>
                      </div>
                    </div>
                    <div className="rounded-lg border px-3 py-2">
                      <div className="text-xs text-muted-foreground">
                        Requested session
                      </div>
                      <div className="font-medium">
                        {snapshot.agent.requestedSessionId ?? 'none'}
                      </div>
                    </div>
                    <div className="rounded-lg border px-3 py-2">
                      <div className="text-xs text-muted-foreground">
                        Visible sessions
                      </div>
                      <div className="font-medium">
                        {snapshot.agent.visibleSessionCount}
                      </div>
                    </div>
                    <div className="rounded-lg border px-3 py-2">
                      <div className="text-xs text-muted-foreground">
                        Archived sessions
                      </div>
                      <div className="font-medium">
                        {snapshot.agent.archivedSessionCount}
                      </div>
                    </div>
                    <div className="rounded-lg border px-3 py-2 md:col-span-3">
                      <div className="text-xs text-muted-foreground">
                        Current preview
                      </div>
                      <div className="mt-1 text-sm text-foreground">
                        {snapshot.agent.currentPreview || 'No messages yet.'}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {activeUiStatus === 'error' ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>Current error</CardTitle>
                      <CardDescription>
                        Active UI session is in an error state.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <pre className="overflow-auto rounded-lg border bg-muted/30 p-3 text-xs leading-5 whitespace-pre-wrap text-foreground">
                        {activeUiSession?.lastMessage || 'No error message captured.'}
                      </pre>
                    </CardContent>
                  </Card>
                ) : null}

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MessagesSquare className="size-4" />
                      Sessions
                    </CardTitle>
                    <CardDescription>
                      Live session list from the current agent object.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {snapshot.sessions.length === 0 ? (
                      <div className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
                        No visible sessions.
                      </div>
                    ) : (
                      snapshot.sessions.map((session) => (
                        <div
                          key={session.id}
                          className="rounded-lg border px-3 py-2"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                              <div className="font-medium text-foreground">
                                {session.title}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {session.id}
                              </div>
                            <div className="text-sm text-muted-foreground">
                              {session.lastMessage || 'No messages yet.'}
                            </div>
                          </div>
                            <div className="flex flex-col items-end gap-2">
                              <Badge variant="secondary">
                                {session.messageCount} msgs
                              </Badge>
                              <Badge variant="outline">
                                {sessionStatusMap.get(session.id) ?? 'unknown'}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <HardDrive className="size-4" />
                      Virtual filesystem
                    </CardTitle>
                    <CardDescription>
                      Current workspace state from the agent’s DO-backed
                      filesystem.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-lg border px-3 py-2">
                      <div className="text-xs text-muted-foreground">
                        Backing stores
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {snapshot.virtualFs.backingStores.map((store) => (
                          <Badge key={store} variant="outline">
                            {store}
                          </Badge>
                        ))}
                        <Badge variant="secondary">
                          execute tool uses workspace state
                        </Badge>
                      </div>
                    </div>

                    <WorkspaceEntryList
                      title="Root entries"
                      description="Top-level files and directories in the current workspace."
                      entries={snapshot.virtualFs.rootEntries}
                    />

                    <WorkspaceEntryList
                      title="Sample paths"
                      description="A live sample of paths currently present in the workspace."
                      entries={snapshot.virtualFs.samplePaths}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Cloud className="size-4" />
                      Sandbox
                    </CardTitle>
                    <CardDescription>
                      Current explicit Sandbox DO state for the selected session.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-lg border px-3 py-2">
                        <div className="text-xs text-muted-foreground">
                          Sandbox id
                        </div>
                        <div className="font-medium">{snapshot.sandbox.id}</div>
                      </div>
                      <div className="rounded-lg border px-3 py-2">
                        <div className="text-xs text-muted-foreground">
                          Reachable
                        </div>
                        <div className="mt-1">
                          <StatusBadge available={snapshot.sandbox.reachable} />
                        </div>
                      </div>
                      <div className="rounded-lg border px-3 py-2">
                        <div className="text-xs text-muted-foreground">cwd</div>
                        <div className="font-medium">
                          {snapshot.sandbox.cwd ?? 'unknown'}
                        </div>
                      </div>
                    </div>

                    <TerminalBlock
                      title="/workspace listing"
                      body={snapshot.sandbox.workspaceListing}
                    />

                    <TerminalBlock
                      title="Current directory listing"
                      body={snapshot.sandbox.currentDirectoryListing}
                    />

                    <div className="rounded-lg border px-3 py-2">
                      <div className="text-xs text-muted-foreground">
                        First-class callable surface today
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {snapshot.sandbox.callableRpcMethods.map((method) => (
                          <Badge key={method} variant="secondary">
                            {method}
                          </Badge>
                        ))}
                        <Badge variant="outline">
                          explicit Sandbox DO is not model-visible yet
                        </Badge>
                        <Badge variant="outline">
                          @cloudflare/think sandbox tools still stubbed
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Wrench className="size-4" />
                      SDK stack
                    </CardTitle>
                    <CardDescription>
                      Secondary context: the packages currently backing this
                      agent path.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {snapshot.sdks.map((sdk) => (
                      <SdkCard key={sdk.name} sdk={sdk} />
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Database className="size-4" />
                      Current read
                    </CardTitle>
                    <CardDescription>
                      The live agent object already owns a real VFS and a real
                      explicit Sandbox DO. What is still missing is first-class
                      model tooling for that explicit Sandbox DO.
                    </CardDescription>
                  </CardHeader>
                </Card>
              </div>
            ) : null}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
