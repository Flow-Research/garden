import { and, eq } from 'drizzle-orm'
import { getRequest } from '@tanstack/react-start/server'
import { getDb, schema } from '@/lib/server/db'
import { appEnv } from '@/lib/server/env'
import { computeInboxItems } from '@/lib/server/inbox-compute'
import { sortIssuesByUpdatedAt } from '@/lib/server/inbox-surface'
import { buildConnectionSurface } from '@/lib/server/connection-surface'
import { requireSession } from '@/lib/server/control-plane'
import type { IssuePriority, IssueStatus } from '@garden/core/types'

export type DashboardIssue = {
  id: string
  title: string
  status: IssueStatus
  priority: IssuePriority
  updatedAt: string
  assigneeType: string | null
}

export type DashboardAgent = {
  id: string
  name: string
  status: string
  roleTitle: string | null
  activeIssueCount: number
}

export type DashboardInboxItem = {
  id: string
  title: string
  issue_id: string
  type: string
  severity: string
  created_at: string
}

export type DashboardConnection = {
  id: string
  label: string
  status: string
  toolCount: number
}

export type DashboardBucket = { name: string; value: number; color: string }

export type DashboardOverviewSnapshot = {
  summary: {
    totalIssues: number
    openIssues: number
    blockedIssues: number
    completedIssues: number
    agentCount: number
    skillCount: number
    connectedCount: number
    connectionCount: number
  }
}

export type DashboardDistributionSnapshot = {
  summary: {
    totalIssues: number
    openIssues: number
  }
  issueStatus: DashboardBucket[]
  issuePriority: DashboardBucket[]
}

export type DashboardActivitySnapshot = {
  unreadCount: number
  recentIssues: DashboardIssue[]
  inbox: DashboardInboxItem[]
}

export type DashboardResourcesSnapshot = {
  agents: DashboardAgent[]
  connections: DashboardConnection[]
}

const statusColors: Record<string, string> = {
  backlog: '#9ca3af',
  todo: '#60a5fa',
  in_progress: '#14b8a6',
  in_review: '#f59e0b',
  blocked: '#ef4444',
  done: '#22c55e',
}

const priorityColors: Record<string, string> = {
  urgent: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
  none: '#94a3b8',
}

const issueStatuses = new Set<IssueStatus>([
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'blocked',
  'cancelled',
])

const issuePriorities = new Set<IssuePriority>([
  'urgent',
  'high',
  'medium',
  'low',
  'none',
])

function toIssueStatus(value: string | null): IssueStatus {
  if (value && issueStatuses.has(value as IssueStatus)) {
    return value as IssueStatus
  }

  return 'backlog'
}

function toIssuePriority(value: string | null): IssuePriority {
  if (value && issuePriorities.has(value as IssuePriority)) {
    return value as IssuePriority
  }

  return 'medium'
}

async function requireDashboardAccess(workspaceId: string) {
  const request = getRequest()
  const session = await requireSession(request)

  if (!session) {
    throw new Error('Unauthorized')
  }

  const db = getDb(appEnv)
  const [membership] = await db
    .select({ organizationId: schema.member.organizationId })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, workspaceId),
        eq(schema.member.userId, session.user.id),
      ),
    )

  if (!membership) {
    throw new Error('Workspace access denied')
  }

  return {
    db,
    session,
  }
}

async function loadDashboardConnections(workspaceId: string) {
  const { db } = await requireDashboardAccess(workspaceId)
  const [
    connections,
    githubInstallations,
    capabilities,
    permissionGrants,
    toolCallAudits,
  ] = await Promise.all([
    db
      .select()
      .from(schema.account)
      .where(eq(schema.account.workspaceId, workspaceId)),
    db
      .select()
      .from(schema.githubAppInstallation)
      .where(eq(schema.githubAppInstallation.workspaceId, workspaceId)),
    db.select().from(schema.capability),
    db.select().from(schema.permissionGrant),
    db
      .select()
      .from(schema.toolCallAudit)
      .where(eq(schema.toolCallAudit.workspaceId, workspaceId)),
  ])

  return buildConnectionSurface({
    agentIds: [],
    connections,
    githubInstallations,
    capabilities,
    permissionGrants,
    toolCallAudits,
  })
}

async function loadDashboardIssues(workspaceId: string) {
  const { db } = await requireDashboardAccess(workspaceId)

  return db
    .select()
    .from(schema.issue)
    .where(eq(schema.issue.workspaceId, workspaceId))
}

export async function getDashboardOverviewSnapshot(workspaceId: string) {
  const { db } = await requireDashboardAccess(workspaceId)
  const [issues, agents, skills, connectionSurface] = await Promise.all([
    db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.workspaceId, workspaceId)),
    db
      .select()
      .from(schema.agent)
      .where(eq(schema.agent.workspaceId, workspaceId)),
    db
      .select()
      .from(schema.skill)
      .where(eq(schema.skill.workspaceId, workspaceId)),
    loadDashboardConnections(workspaceId),
  ])

  return {
    summary: {
      totalIssues: issues.length,
      openIssues: issues.filter((issue) => issue.status !== 'done').length,
      blockedIssues: issues.filter((issue) => issue.status === 'blocked')
        .length,
      completedIssues: issues.filter((issue) => issue.status === 'done').length,
      agentCount: agents.length,
      skillCount: skills.length,
      connectedCount: connectionSurface.filter(
        (connector) => connector.status === 'connected',
      ).length,
      connectionCount: connectionSurface.length,
    },
  } satisfies DashboardOverviewSnapshot
}

export async function getDashboardDistributionSnapshot(workspaceId: string) {
  const issues = await loadDashboardIssues(workspaceId)

  const issueStatus = Array.from(
    issues.reduce((map, issue) => {
      const status = issue.status ?? 'backlog'
      map.set(status, (map.get(status) ?? 0) + 1)
      return map
    }, new Map<string, number>()),
  ).map(([name, value]) => ({
    name: name.replaceAll('_', ' '),
    value,
    color: statusColors[name] ?? '#94a3b8',
  }))

  const issuePriority = Array.from(
    issues.reduce((map, issue) => {
      const priority = issue.priority ?? 'medium'
      map.set(priority, (map.get(priority) ?? 0) + 1)
      return map
    }, new Map<string, number>()),
  ).map(([name, value]) => ({
    name,
    value,
    color: priorityColors[name] ?? '#94a3b8',
  }))

  return {
    summary: {
      totalIssues: issues.length,
      openIssues: issues.filter((issue) => issue.status !== 'done').length,
    },
    issueStatus,
    issuePriority,
  } satisfies DashboardDistributionSnapshot
}

export async function getDashboardActivitySnapshot(workspaceId: string) {
  const { session } = await requireDashboardAccess(workspaceId)
  const [issues, inbox] = await Promise.all([
    loadDashboardIssues(workspaceId),
    computeInboxItems({ workspaceId, userId: session.user.id }),
  ])

  const recentIssues = sortIssuesByUpdatedAt(issues)
    .slice(0, 8)
    .map((issue) => ({
      id: issue.id,
      title: issue.title,
      status: toIssueStatus(issue.status),
      priority: toIssuePriority(issue.priority),
      updatedAt: (
        issue.updatedAt ??
        issue.createdAt ??
        new Date()
      ).toISOString(),
      assigneeType:
        issue.assigneeType === 'user' ? 'member' : issue.assigneeType,
    }))

  return {
    unreadCount: inbox.filter((item) => !item.read).length,
    recentIssues,
    inbox: inbox.slice(0, 6).map((item) => ({
      id: item.id,
      title: item.title,
      issue_id: item.issue_id ?? '',
      type: item.type,
      severity: item.severity,
      created_at: item.created_at,
    })),
  } satisfies DashboardActivitySnapshot
}

export async function getDashboardResourcesSnapshot(workspaceId: string) {
  const { db } = await requireDashboardAccess(workspaceId)
  const [issues, agents, connectionSurface] = await Promise.all([
    db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.workspaceId, workspaceId)),
    db
      .select()
      .from(schema.agent)
      .where(eq(schema.agent.workspaceId, workspaceId)),
    loadDashboardConnections(workspaceId),
  ])

  const activeIssueCountByAgentId = issues.reduce((map, issue) => {
    if (issue.assigneeType !== 'agent' || !issue.assigneeId) return map
    if (issue.status === 'done' || issue.status === 'cancelled') return map
    map.set(issue.assigneeId, (map.get(issue.assigneeId) ?? 0) + 1)
    return map
  }, new Map<string, number>())

  return {
    agents: agents.slice(0, 5).map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status ?? 'idle',
      roleTitle: agent.roleTitle ?? null,
      activeIssueCount: activeIssueCountByAgentId.get(agent.id) ?? 0,
    })),
    connections: connectionSurface.map((connector) => ({
      id: connector.id,
      label: connector.label,
      status: connector.status,
      toolCount: connector.toolCount,
    })),
  } satisfies DashboardResourcesSnapshot
}
