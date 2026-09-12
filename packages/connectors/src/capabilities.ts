import type { RiskClass } from './sdk.ts'

export type { RiskClass } from './sdk.ts'

export const RISK_CLASSES = [
  'read',
  'write',
  'send_external',
  'destructive',
] as const satisfies readonly RiskClass[]

export const PERMISSION_TRUST_LEVELS = ['auto', 'allow', 'ask'] as const

export type PermissionTrustLevel = (typeof PERMISSION_TRUST_LEVELS)[number]

export function defaultTrustLevelForRisk(
  riskClass: RiskClass | string | null | undefined,
): PermissionTrustLevel {
  switch (riskClass) {
    case 'read':
      return 'auto'
    case 'write':
      return 'allow'
    default:
      return 'ask'
  }
}

export type EffectiveTrustInput = {
  toolTrust?: PermissionTrustLevel | string | null
  connectionTrust?: PermissionTrustLevel | string | null
  riskClass: RiskClass | string | null | undefined
}

export type EffectiveTrust = {
  trust: PermissionTrustLevel
  visible: boolean
}

/**
 * Single source of truth for effective tool trust. Resolution order is tool
 * grant, connection grant, risk default; visibility derives last as
 * granted-visible so the access view, the runtime gate, and the connection
 * surface can never disagree about what an agent may use.
 */
export function resolveEffectiveTrust(input: EffectiveTrustInput): EffectiveTrust {
  const trust =
    (input.toolTrust as PermissionTrustLevel | undefined) ??
    (input.connectionTrust as PermissionTrustLevel | undefined) ??
    defaultTrustLevelForRisk(input.riskClass)
  return { trust, visible: trust !== 'ask' }
}

export function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJson(entry))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeJson(entry)]),
    )
  }

  return value
}

export function canonicalJsonString(value: unknown) {
  return JSON.stringify(canonicalizeJson(value ?? null))
}

export function buildMcpAiToolKey(connectorId: string, toolName: string) {
  return `tool_${connectorId.replace(/-/g, '')}_${toolName}`
}

export type ExecutorToolRef = {
  executorSlug: string
  owner: string
  connection: string
  tool: string
}

export const EXECUTOR_TOOL_REF_PATTERN =
  /tools\.([A-Za-z0-9_-]+)\.(org|user)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_.$-]+?)\s*\(/g

export function extractExecutorToolRefs(code: unknown): ExecutorToolRef[] {
  if (typeof code !== 'string' || code.length === 0) return []
  const refs: ExecutorToolRef[] = []
  const seen = new Set<string>()
  for (const match of code.matchAll(EXECUTOR_TOOL_REF_PATTERN)) {
    const [, executorSlug, owner, connection, tool] = match
    if (!executorSlug || !owner || !connection || !tool) continue
    const key = `${executorSlug}.${owner}.${connection}.${tool}`
    if (seen.has(key)) continue
    seen.add(key)
    refs.push({ executorSlug, owner, connection, tool })
  }
  return refs
}

export function guardedMcpToolDescription(input: {
  connectorId: string
  toolName: string
  description?: string | null
}) {
  const base = input.description?.trim() ?? ''
  const writeLike =
    /(^|_)(write|create|update|delete|close|merge|comment|send|publish|grant|revoke)($|_)/i.test(
      input.toolName,
    )
  if (!writeLike) return base || undefined

  const guard =
    `External ${input.connectorId} write tool. Use only when the user explicitly asks to change ${input.connectorId} or a source-bound external object. ` +
    'Do not use this for generic Garden issue commands; use Garden issue tools such as update_issue_status instead.'
  return base ? `${guard}\n\n${base}` : guard
}
