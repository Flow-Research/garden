import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-serverless'
import type { ContextProvider } from 'agents/experimental/memory/session'
import * as schema from '@garden/db/schema'
import {
  FOUNDATION_SECTION_ORDER,
  FOUNDATION_SECTIONS,
  type PromptSection,
} from './instructions/base'

type OrderedPromptSections<TOrder extends readonly string[]> = {
  readonly [TId in TOrder[number]]: PromptSection<TId>
}

type AgentPromptContextRecord = Readonly<{
  agentName: string
  agentDescription: string | null
  agentInstructions: string | null
  workspaceName: string | null
  workspaceContext: string | null
}>

export interface AgentPromptCatalog {
  getAgentPromptContext(input: {
    agentRuntimeName: string
  }): Promise<AgentPromptContextRecord | null>
}

function renderOrderedPromptSections<TOrder extends readonly string[]>(input: {
  order: TOrder
  sections: OrderedPromptSections<TOrder>
}) {
  return input.order
    .map((sectionId) => {
      const section = input.sections[sectionId as TOrder[number]]
      return `## ${section.title}\n${section.body.trim()}`
    })
    .join('\n\n')
}

function renderPromptList(
  heading: string,
  values: readonly [label: string, value: string][],
) {
  return [
    heading,
    ...values.map(([label, value]) => `- ${label}: ${value}`),
  ].join('\n')
}

function createStaticPromptProvider(content: string): ContextProvider {
  return {
    get: async () => content,
  }
}

function createPromptDb(databaseUrl: string) {
  return drizzle(databaseUrl, { schema })
}

export function assembleFoundationPrompt() {
  return renderOrderedPromptSections({
    order: FOUNDATION_SECTION_ORDER,
    sections: FOUNDATION_SECTIONS,
  })
}

export function assembleAgentPrompt(
  record: AgentPromptContextRecord | null,
): string {
  if (!record) return ''

  const agentIdentity = renderPromptList('Current agent', [
    ['system name', 'Garden'],
    ['profile name', record.agentName],
    ['role', record.agentDescription?.trim() || 'Workspace agent'],
  ])

  const instructions =
    record.agentInstructions?.trim() || 'No owner-authored instructions set.'

  return [agentIdentity, '', 'Owner-authored instructions', instructions].join(
    '\n',
  )
}

export function assembleWorkspacePrompt(
  record: AgentPromptContextRecord | null,
): string {
  if (!record) return ''

  const workspaceIdentity = renderPromptList('Workspace', [
    ['name', record.workspaceName?.trim() || 'Unknown workspace'],
  ])

  const context = record.workspaceContext?.trim() || 'No shared context set.'

  return [workspaceIdentity, '', 'Shared context', context].join('\n')
}

export class PostgresAgentPromptCatalog implements AgentPromptCatalog {
  private readonly db: ReturnType<typeof createPromptDb>

  constructor(databaseUrl: string) {
    this.db = createPromptDb(databaseUrl)
  }

  async getAgentPromptContext(input: {
    agentRuntimeName: string
  }): Promise<AgentPromptContextRecord | null> {
    const [row] = await this.db
      .select({
        agentName: schema.agent.name,
        agentDescription: schema.agent.roleTitle,
        agentInstructions: schema.agent.instructions,
        workspaceName: schema.organization.name,
        workspaceContext: schema.organization.context,
      })
      .from(schema.agent)
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.agent.workspaceId),
      )
      .where(eq(schema.agent.hostName, input.agentRuntimeName))
      .limit(1)

    if (!row) return null

    return row
  }
}

export function createPromptContextProviders(input: {
  agentRuntimeName: string
  catalog: AgentPromptCatalog
}) {
  let recordPromise: Promise<AgentPromptContextRecord | null> | null = null

  const loadRecord = () => {
    if (!recordPromise) {
      recordPromise = input.catalog.getAgentPromptContext({
        agentRuntimeName: input.agentRuntimeName,
      })
    }

    return recordPromise
  }

  return {
    foundation: {
      description:
        'Base Garden operating contract. Later context refines this but does not override it.',
      provider: createStaticPromptProvider(assembleFoundationPrompt()),
    },
    agent: {
      description:
        'Current agent identity, role, and owner-authored instructions.',
      provider: {
        get: async () => assembleAgentPrompt(await loadRecord()),
      } satisfies ContextProvider,
    },
    workspace: {
      description: 'Shared workspace context for this agent.',
      provider: {
        get: async () => assembleWorkspacePrompt(await loadRecord()),
      } satisfies ContextProvider,
    },
  }
}
