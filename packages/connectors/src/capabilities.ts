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
