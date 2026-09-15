import { and, eq, isNotNull } from 'drizzle-orm'
import { schema } from '@/lib/server/db'
import type { AppRequestContext } from '@/lib/server/context'

/**
 * Home surface snapshot (Penpot "↪︎ Home", 2026-09). Replaces the retired
 * dashboard snapshots: the new design needs workspace member/task/points stat
 * cards plus a platform-usage section, none of which the old dashboard
 * aggregated. Points/wallet/spend have no billing backend yet — they ship as
 * typed zeros so the UI contract is stable when the domain lands.
 */
export type HomeSnapshot = {
  stats: {
    memberCount: number
    assignedTaskCount: number
    totalPoints: number
  }
  wallet: {
    points: number
    /** Wallet balance in Nigerian naira; formatting is client-side. */
    nairaValue: number
  }
  usage: {
    inputTokens: number
    outputTokens: number
    reasoningTokens: number
    totalTokens: number
  }
  spend: {
    totalSpendNaira: number
    rows: { key: string; label: string; amountNaira: number; color: string }[]
  }
}

/** Swatch colors reference token vars so both themes resolve client-side. */
const SPEND_ROWS = [
  { key: 'custom_agent', label: 'Custom Agent', color: 'var(--gray-400)' },
  {
    key: 'system_optimiser',
    label: 'System Optimiser',
    color: 'var(--background-brand-default)',
  },
  { key: 'other', label: 'Other', color: 'var(--yellow-500)' },
] as const

function numericUsage(usage: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = usage[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return 0
}

function readUsage(usageJson: unknown) {
  const usage =
    usageJson && typeof usageJson === 'object' && !Array.isArray(usageJson)
      ? (usageJson as Record<string, unknown>)
      : null
  if (!usage) return { input: 0, output: 0, reasoning: 0 }
  return {
    input: numericUsage(usage, ['input_tokens']),
    output: numericUsage(usage, ['output_tokens']),
    reasoning: numericUsage(usage, ['reasoning_tokens']),
  }
}

export async function getHomeSnapshot(
  appContext: AppRequestContext,
  workspaceId: string,
): Promise<HomeSnapshot> {
  const session = await appContext.auth.getSession()

  if (!session) {
    throw new Error('Unauthorized')
  }

  const db = await appContext.db()
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

  const [members, assignedIssues, issueRuns, automationRuns] =
    await Promise.all([
      db
        .select({ id: schema.member.id })
        .from(schema.member)
        .where(eq(schema.member.organizationId, workspaceId)),
      db
        .select({ id: schema.issue.id })
        .from(schema.issue)
        .where(
          and(
            eq(schema.issue.workspaceId, workspaceId),
            isNotNull(schema.issue.assigneeId),
          ),
        ),
      db
        .select({ usageJson: schema.issueRun.usageJson })
        .from(schema.issueRun)
        .innerJoin(schema.issue, eq(schema.issueRun.issueId, schema.issue.id))
        .where(eq(schema.issue.workspaceId, workspaceId)),
      db
        .select({ usageJson: schema.automationRun.usageJson })
        .from(schema.automationRun)
        .where(eq(schema.automationRun.workspaceId, workspaceId)),
    ])

  let inputTokens = 0
  let outputTokens = 0
  let reasoningTokens = 0
  for (const run of [...issueRuns, ...automationRuns]) {
    const usage = readUsage(run.usageJson)
    inputTokens += usage.input
    outputTokens += usage.output
    reasoningTokens += usage.reasoning
  }

  return {
    stats: {
      memberCount: members.length,
      assignedTaskCount: assignedIssues.length,
      totalPoints: 0,
    },
    wallet: { points: 0, nairaValue: 0 },
    usage: {
      inputTokens,
      outputTokens,
      reasoningTokens,
      totalTokens: inputTokens + outputTokens + reasoningTokens,
    },
    spend: {
      totalSpendNaira: 0,
      rows: SPEND_ROWS.map((row) => ({ ...row, amountNaira: 0 })),
    },
  }
}
