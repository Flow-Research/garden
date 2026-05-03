'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot, Search } from 'lucide-react'
import type { Agent } from '@garden/core/types'
import { agentListOptions } from '@/lib/workspace/queries'
import { useWorkspaceId } from '@garden/core/hooks'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@garden/ui/components/ui/avatar'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@garden/ui/components/ui/empty'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@garden/ui/components/ui/input-group'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { cn } from '@garden/ui/lib/utils'

const STATUS_COLOR: Record<Agent['status'], string> = {
  idle: 'bg-zinc-400',
  working: 'bg-emerald-500',
  blocked: 'bg-amber-500',
  error: 'bg-red-500',
  offline: 'bg-zinc-300',
}

export default function AgentsPage({
  onOpenAgent,
}: {
  onOpenAgent: (agent: Agent) => void
}) {
  const wsId = useWorkspaceId()
  const [filter, setFilter] = useState('')

  const agentsQuery = useQuery(agentListOptions(wsId))
  const agents = agentsQuery.data ?? []

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return agents
      .filter((agent) => !agent.archived_at)
      .filter(
        (agent) =>
          !q ||
          agent.name.toLowerCase().includes(q) ||
          (agent.description?.toLowerCase().includes(q) ?? false),
      )
  }, [agents, filter])

  if (agentsQuery.isPending) {
    return <AgentsPageSkeleton />
  }

  if (agents.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Empty className="max-w-sm border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Bot />
            </EmptyMedia>
            <EmptyTitle>No agents yet</EmptyTitle>
            <EmptyDescription>
              Agents are the workers that execute tasks. They pick up issues,
              run skills, and report back.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <p className="text-xs text-muted-foreground">
              Create flow lands next.
            </p>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b px-6 py-3">
        <div>
          <h1 className="text-base font-semibold text-foreground">Agents</h1>
          <p className="text-xs text-muted-foreground">
            {agents.length} {agents.length === 1 ? 'agent' : 'agents'} in this
            workspace
          </p>
        </div>
        <InputGroup className="max-w-xs">
          <InputGroupAddon>
            <Search className="text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter agents"
          />
        </InputGroup>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 py-12 text-center">
            <p className="text-sm text-foreground">No matches</p>
            <p className="text-xs text-muted-foreground">
              No agents match &ldquo;{filter}&rdquo;.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onOpen={() => onOpenAgent(agent)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AgentCard({ agent, onOpen }: { agent: Agent; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors',
        'hover:border-foreground/20 hover:bg-accent/30',
      )}
    >
      <div className="flex w-full items-center gap-3">
        <Avatar>
          {agent.avatar_url ? <AvatarImage src={agent.avatar_url} /> : null}
          <AvatarFallback>
            <Bot className="size-4" />
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {agent.name}
            </span>
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                STATUS_COLOR[agent.status],
              )}
              aria-hidden="true"
              title={agent.status}
            />
          </div>
          <p className="mt-0.5 truncate text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {agent.runtime_mode} · {agent.visibility}
          </p>
        </div>
      </div>
      {agent.description ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {agent.description}
        </p>
      ) : null}
      <div className="mt-auto flex w-full items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {agent.skills?.length ?? 0}{' '}
          {(agent.skills?.length ?? 0) === 1 ? 'skill' : 'skills'}
        </span>
        <span>Max {agent.max_concurrent_tasks}</span>
      </div>
    </button>
  )
}

function AgentsPageSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b px-6 py-3">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="h-8 w-48 rounded-md" />
      </div>
      <div className="grid flex-1 gap-3 px-6 py-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, idx) => (
          <Skeleton key={idx} className="h-32 rounded-xl" />
        ))}
      </div>
    </div>
  )
}
