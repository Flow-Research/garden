import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot, Loader2 } from 'lucide-react'
import type { Agent } from '@garden/core/types'
import { agentDetailOptions } from '@/lib/workspace/queries'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@garden/ui/components/ui/avatar'
import { Badge } from '@garden/ui/components/ui/badge'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@garden/ui/components/ui/tabs'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import { cn } from '@garden/ui/lib/utils'

import { AgentAccessTab } from './agent-access-tab'
import { AgentSkillsTab } from './agent-skills-tab'

const STATUS_COLOR: Record<Agent['status'], string> = {
  idle: 'bg-zinc-400',
  working: 'bg-emerald-500',
  blocked: 'bg-amber-500',
  error: 'bg-red-500',
  offline: 'bg-zinc-300',
}

export function AgentDetail({
  agentId,
  onOpenSkill,
}: {
  agentId: string
  onOpenSkill: (skillId: string, name: string) => void
}) {
  const [tab, setTab] = useState('overview')
  const detailQuery = useQuery(agentDetailOptions(agentId))
  const agent = detailQuery.data ?? null

  if (detailQuery.isPending) {
    return <AgentDetailSkeleton />
  }

  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
        {detailQuery.error instanceof Error
          ? detailQuery.error.message
          : 'Agent not found.'}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 items-start gap-4 border-b px-6 py-5">
        <Avatar size="lg">
          {agent.avatar_url ? <AvatarImage src={agent.avatar_url} /> : null}
          <AvatarFallback>
            <Bot className="size-5" />
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-base font-semibold text-foreground">
              {agent.name}
            </h1>
            <StatusPill status={agent.status} />
          </div>
          {agent.description ? (
            <p className="mt-1 line-clamp-2 max-w-2xl text-xs text-muted-foreground">
              {agent.description}
            </p>
          ) : null}
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as string)}
        className="flex flex-1 min-h-0 flex-col"
      >
        <div className="shrink-0 border-b px-6 pt-2">
          <TabsList variant="line" className="h-9">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
            <TabsTrigger value="access">Access</TabsTrigger>
            <TabsTrigger value="instructions">Instructions</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <TabsContent value="overview" className="px-6 py-5">
            <OverviewPane agent={agent} />
          </TabsContent>
          <TabsContent value="skills" className="px-6 py-5">
            <AgentSkillsTab agentId={agent.id} onOpenSkill={onOpenSkill} />
          </TabsContent>
          <TabsContent value="access" className="px-6 py-5">
            <AgentAccessTab agentId={agent.id} />
          </TabsContent>
          <TabsContent value="instructions" className="px-6 py-5">
            <InstructionsPane agent={agent} />
          </TabsContent>
          <TabsContent value="activity" className="px-6 py-5">
            <PlaceholderPane title="Activity" />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}

function StatusPill({ status }: { status: Agent['status'] }) {
  return (
    <Badge
      variant="outline"
      className="rounded-full border-border/70 bg-muted/40 text-[11px] text-muted-foreground capitalize"
    >
      <span className={cn('size-1.5 rounded-full', STATUS_COLOR[status])} />
      {status}
    </Badge>
  )
}

function OverviewPane({ agent }: { agent: Agent }) {
  const items: { label: string; value: React.ReactNode }[] = [
    { label: 'Runtime mode', value: agent.runtime_mode },
    { label: 'Visibility', value: agent.visibility },
    {
      label: 'Max concurrent tasks',
      value: agent.max_concurrent_tasks,
    },
    {
      label: 'Reports to',
      value: agent.reports_to ?? '—',
    },
  ]

  return (
    <div className="grid max-w-2xl gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {item.label}
          </p>
          <p className="mt-0.5 text-sm text-foreground">{item.value}</p>
        </div>
      ))}
    </div>
  )
}

function InstructionsPane({ agent }: { agent: Agent }) {
  if (!agent.instructions?.trim()) {
    return <PlaceholderPane title="Instructions" />
  }

  return (
    <pre className="max-w-3xl whitespace-pre-wrap rounded-md border bg-muted/30 px-4 py-3 font-mono text-xs leading-relaxed text-foreground">
      {agent.instructions}
    </pre>
  )
}

function PlaceholderPane({ title }: { title: string }) {
  return (
    <div className="flex max-w-md flex-col gap-2 rounded-md border border-dashed px-4 py-6 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground">
        Coming soon. This surface will land alongside the rest of the agent
        operations toolkit.
      </p>
    </div>
  )
}

function AgentDetailSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-start gap-4 border-b px-6 py-5">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        <Loader2 className="mr-2 size-3.5 animate-spin" />
        Loading agent…
      </div>
    </div>
  )
}
