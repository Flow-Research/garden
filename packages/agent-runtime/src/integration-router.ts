import type { ExecutorCatalog } from '@garden/core/executor/catalog'
import { integrationSkills, type IntegrationSkill } from './integration-skills'

export type RouteAttachment = {
  filename?: string | null
  mediaType?: string | null
}

export type IntegrationRoute = {
  slug: string
  name: string
  connected: boolean
  score: number
  matchedTerms: string[]
  allowedToolNames: string[]
  connectionLabel: string | null
}

export type IntegrationRouteDecision = {
  status: 'selected' | 'none'
  skill: IntegrationSkill | null
  routes: IntegrationRoute[]
  reason: string
}

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'please',
  'that',
  'the',
  'this',
  'to',
  'with',
  'you',
  'your',
])

function stem(token: string): string {
  if (token.length <= 3) return token
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.endsWith('ing')) return token.slice(0, -3)
  if (token.endsWith('ed')) return token.slice(0, -2)
  if (token.endsWith('es')) return token.slice(0, -2)
  if (token.endsWith('s')) return token.slice(0, -1)
  return token
}

function terms(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((token) => token.length > 1 && !STOPWORDS.has(token))
      .map(stem),
  )
}

function intersection(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((term) => right.has(term))
}

function attachmentText(attachments: readonly RouteAttachment[]): string {
  return attachments
    .flatMap((attachment) => [attachment.filename, attachment.mediaType])
    .filter((value): value is string => Boolean(value))
    .join(' ')
}

const STRUCTURED_DATA_FILENAME = /\.(?:csv|xlsx|tsv)$/i
const STRUCTURED_DATA_MEDIA_TYPE = /(?:text\/csv|spreadsheet|ms-excel)/i

/**
 * Extracts document filenames from the turn's document context so a selected
 * or uploaded workspace document can act as routing evidence. Before this,
 * uploads were persisted as documents rather than message file parts, so the
 * router only saw the filename inside a paragraph of prompt boilerplate. The
 * boilerplate terms could accidentally match an integration while the actual
 * file type never reached skill selection.
 */
function documentAttachmentsFromContext(
  documentContext?: string | null,
): RouteAttachment[] {
  if (!documentContext) return []
  const attachments: RouteAttachment[] = []
  for (const line of documentContext.split('\n')) {
    const match = /^\s*-\s*handle:\s*[^;]+;\s*filename:\s*(.+)$/i.exec(line)
    const raw = match?.[1]?.trim()
    if (!raw) continue
    const filename = raw
      .replace(/;\s*selected_version:.*$/i, '')
      .replace(/\s+\(V\d+\)$/i, '')
      .trim()
    if (filename) attachments.push({ filename })
  }
  return attachments
}

function isStructuredDataAttachment(attachment: RouteAttachment): boolean {
  const value = `${attachment.filename ?? ''} ${attachment.mediaType ?? ''}`
  return (
    STRUCTURED_DATA_FILENAME.test(value) ||
    STRUCTURED_DATA_MEDIA_TYPE.test(value)
  )
}

/**
 * Resolves the structured-data skill from the shared integration registry.
 * Before document-context routing, selected XLSX files could not select this
 * skill because they were not represented as message attachments.
 */
function structuredDataSkill(): IntegrationSkill | null {
  return (
    integrationSkills.find((skill) => skill.id === 'analyze-structured-data') ??
    null
  )
}

function isInformationalRequest(userText: string, hasAttachments: boolean) {
  if (hasAttachments) return false
  return /^(how (do|can|should|would) i|how to|what is|what's|why|explain|teach me|show me how)\b/i.test(
    userText.trim(),
  )
}

/** Selects a task skill from its examples, description, and accepted media. */
function selectSkill(
  query: string,
  attachments: readonly RouteAttachment[],
): IntegrationSkill | null {
  const queryTerms = terms(query)
  const attachmentValue = attachmentText(attachments)
  const ranked = integrationSkills
    .map((skill) => {
      const skillTerms = terms(
        [skill.name, skill.description, ...skill.examples].join(' '),
      )
      const textMatches = intersection(queryTerms, skillTerms).length
      const mediaMatch = skill.mediaTypes.some((pattern) =>
        pattern.test(attachmentValue),
      )
      return { skill, score: textMatches + (mediaMatch ? 8 : 0) }
    })
    .sort((left, right) => right.score - left.score)

  const [top, second] = ranked
  if (!top || top.score < 2 || top.score === second?.score) return null
  return top.skill
}

function connectionLabel(
  catalog: ExecutorCatalog,
  slug: string,
): string | null {
  const labels = catalog.connections
    .filter((connection) => connection.integration === slug)
    .map((connection) => connection.identityLabel ?? connection.name)
    .filter((label): label is string => Boolean(label))
  return labels.length > 0 ? labels.join(', ') : null
}

/** Ranks one integration by declared capabilities and its live tool catalog. */
function rankIntegration(args: {
  catalog: ExecutorCatalog
  integration: ExecutorCatalog['integrations'][number]
  query: string
  skill: IntegrationSkill | null
}): IntegrationRoute | null {
  const { catalog, integration, query, skill } = args
  const connected = catalog.connections.some(
    (connection) => connection.integration === integration.slug,
  )
  const queryTerms = terms(query)
  const directTerms = intersection(
    queryTerms,
    terms(`${integration.slug} ${integration.name}`),
  )
  const directMention = directTerms.length > 0
  if (!connected && !directMention) return null

  const toolRows = catalog.tools.filter(
    (tool) => tool.integration === integration.slug,
  )
  const capabilityTerms = terms(
    [
      integration.description,
      ...integration.capabilities,
      ...toolRows.flatMap((tool) => [tool.name, tool.description]),
    ].join(' '),
  )
  const requiredTerms = terms(skill?.requiredCapabilities.join(' ') ?? query)
  const capabilityMatches = intersection(requiredTerms, capabilityTerms)
  const queryMatches = intersection(queryTerms, capabilityTerms)
  if (!directMention && capabilityMatches.length === 0) return null

  const allowedToolNames = toolRows
    .filter((tool) => {
      const toolTerms = terms(`${tool.name} ${tool.description}`)
      return (
        intersection(toolTerms, requiredTerms).length > 0 ||
        intersection(toolTerms, queryTerms).length > 0
      )
    })
    .slice(0, 8)
    .map((tool) => tool.name)

  return {
    slug: integration.slug,
    name: integration.name,
    connected,
    score:
      capabilityMatches.length * 3 +
      queryMatches.length +
      directTerms.length * 8 +
      (connected ? 4 : 0),
    matchedTerms: [...new Set([...directTerms, ...capabilityMatches])].slice(
      0,
      8,
    ),
    allowedToolNames,
    connectionLabel: connectionLabel(catalog, integration.slug),
  }
}

/**
 * Matches a request to a task skill, then ranks integrations from runtime
 * metadata. Adding an integration changes its registration, not this router.
 */
export function selectIntegrationRoute(args: {
  userText: string
  documentContext?: string | null
  attachments?: readonly RouteAttachment[]
  catalog: ExecutorCatalog | null
}): IntegrationRouteDecision {
  const attachments = [
    ...(args.attachments ?? []),
    ...documentAttachmentsFromContext(args.documentContext),
  ]
  const query = [args.userText, attachmentText(attachments)]
    .filter(Boolean)
    .join(' ')
  const skill =
    selectSkill(query, attachments) ??
    (attachments.some(isStructuredDataAttachment)
      ? structuredDataSkill()
      : null)

  if (!args.catalog) {
    return {
      status: 'none',
      skill,
      routes: [],
      reason: 'Executor catalog is unavailable.',
    }
  }

  const catalog = args.catalog
  const routes = catalog.integrations
    .map((integration) =>
      rankIntegration({ catalog, integration, query, skill }),
    )
    .filter((route): route is IntegrationRoute => route !== null)
    .sort((left, right) => right.score - left.score)
  const [top, second] = routes

  if (isInformationalRequest(args.userText, attachments.length > 0)) {
    return {
      status: 'none',
      skill,
      routes: routes.slice(0, 3),
      reason: 'The request asks for an explanation, not an integration run.',
    }
  }
  if (!top || top.score < 6) {
    return {
      status: 'none',
      skill,
      routes: routes.slice(0, 3),
      reason: 'No integration matched with enough confidence.',
    }
  }
  if (second && second.score >= top.score - 2) {
    return {
      status: 'none',
      skill,
      routes: routes.slice(0, 3),
      reason: `The request matches both ${top.name} and ${second.name}.`,
    }
  }

  return {
    status: 'selected',
    skill,
    routes: [top],
    reason: skill
      ? `${top.name} provides the capabilities required by ${skill.name}.`
      : `${top.name} was named or matched its registered capabilities.`,
  }
}

/** Builds the runtime contract supplied to the model for this turn. */
export function renderIntegrationRouteDirective(
  decision: IntegrationRouteDecision,
): string {
  if (decision.status !== 'selected') return ''
  const route = decision.routes[0]
  if (!route) return ''
  if (!route.connected) {
    return `${route.name} matches this request but is not connected. Ask the user to connect it.`
  }

  const lines =
    route.slug === 'decide'
      ? [
          'Use the direct Decide tools for this turn.',
          'Do not use Executor execute for Decide.',
          `Reason: ${decision.reason}`,
        ]
      : [
          `Use ${route.name} through Executor for this turn.`,
          `Executor integration slug: ${route.slug}.`,
          `Reason: ${decision.reason}`,
        ]
  if (decision.skill) lines.push(...decision.skill.instructions)
  if (
    route.slug === 'decide' &&
    decision.skill?.id === 'analyze-structured-data'
  ) {
    lines.push(
      'Call decide_analyze for the initial analysis and follow-up questions.',
      'Use decide_list_generated_files and decide_read_generated_file when the user requests a generated report.',
      'For an uploaded file, call Garden readDocument with the document handle from the document context before calling Decide.',
      'Pass the complete text returned by readDocument as Decide analyze data. Do not pass a summary, sample, or truncated content.',
      'For a follow-up analysis, reuse the session_id returned by Decide and omit data unless the user provides a different file.',
      'Render every text block from Decide in order and return generated report links when present.',
      'If Decide reports an incomplete analysis or the call times out, show that status and the exact error. Do not retry automatically. Ask for a narrower request or a smaller file.',
    )
  }
  if (route.slug !== 'decide' && route.allowedToolNames.length > 0) {
    lines.push(`Allowed tools: ${route.allowedToolNames.join(', ')}.`)
  }
  if (route.slug !== 'decide') {
    lines.push(
      'Load the Executor execute guide if needed, then search and call only this integration.',
    )
  }
  lines.push(
    `If ${route.name} fails, report the exact error. Do not silently replace it with local analysis.`,
  )
  return lines.join('\n')
}

export function requestNeedsConnectedTools(
  decision: IntegrationRouteDecision,
): boolean {
  return (
    decision.status === 'selected' && decision.routes[0]?.connected === true
  )
}

export function isIntegrationToolAllowed(
  decision: IntegrationRouteDecision | null,
  integrationSlug: string,
  toolName?: string,
): boolean {
  if (decision?.status !== 'selected') return true
  const route = decision.routes[0]
  if (route?.slug !== integrationSlug) return false
  if (!toolName || route.allowedToolNames.length === 0) return true
  return route.allowedToolNames.includes(toolName)
}
