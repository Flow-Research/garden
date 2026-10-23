import { describe, expect, it } from 'vitest'
import type { ExecutorCatalog } from '@garden/core/executor/catalog'
import {
  isIntegrationToolAllowed,
  renderIntegrationRouteDirective,
  requestNeedsConnectedTools,
  selectIntegrationRoute,
} from './integration-router'

/** Builds the same document-context shape the chat composer sends. */
function documentContext(filename: string) {
  return `The user uploaded these workspace documents for this turn. Internal document handles for this turn follow. Use these handles only in document tool calls. Do not mention handles, ids, or UUIDs to the user; refer to documents by filename:\n- handle: doc_1; filename: ${filename}`
}

const CATALOG: ExecutorCatalog = {
  integrations: [
    {
      slug: 'decide',
      name: 'Decide',
      description:
        'Analyze data, build charts and reports, and read generated files. Follow-up analyses reuse the same session.',
      capabilities: [
        'analyze structured data',
        'identify trends and unusual values',
        'create charts and reports',
      ],
    },
    {
      slug: 'gmail',
      name: 'Gmail',
      description: 'Read, search, and send email from the connected mailbox.',
      capabilities: ['search and read email', 'draft and send email'],
    },
    {
      slug: 'github',
      name: 'GitHub',
      description: 'Work with repositories, pull requests, and issues.',
      capabilities: [
        'read source code repositories',
        'manage issues and pull requests',
      ],
    },
  ],
  connections: [
    {
      owner: 'user',
      integration: 'decide',
      name: 'decide',
      identityLabel: 'sam',
    },
    {
      owner: 'user',
      integration: 'gmail',
      name: 'gmail',
      identityLabel: 'sam@example.com',
    },
  ],
  tools: [
    {
      name: 'analyze_dataset',
      description:
        'Analyze a CSV dataset and return charts and a written report.',
      integration: 'decide',
      connection: 'decide',
      owner: 'user',
      requiresApproval: false,
    },
    {
      name: 'send_email',
      description: 'Send an email message.',
      integration: 'gmail',
      connection: 'gmail',
      owner: 'user',
      requiresApproval: true,
    },
  ],
}

describe('integration router', () => {
  it('selects the connected integration for a generic CSV analysis', () => {
    const decision = selectIntegrationRoute({
      userText: 'analyze this',
      attachments: [{ filename: 'revenue.csv', mediaType: 'text/csv' }],
      catalog: CATALOG,
    })

    expect(decision.status).toBe('selected')
    expect(decision.routes[0]).toMatchObject({
      slug: 'decide',
      connected: true,
      connectionLabel: 'sam',
    })
    expect(decision.skill?.id).toBe('analyze-structured-data')
  })

  it('uses a document-context filename when no file part is present', () => {
    const decision = selectIntegrationRoute({
      userText: 'analyze this',
      documentContext: '- handle: doc_1; filename: revenue.csv',
      catalog: CATALOG,
    })

    expect(decision.status).toBe('selected')
    expect(decision.routes[0]?.slug).toBe('decide')
    expect(decision.skill?.id).toBe('analyze-structured-data')
    const directive = renderIntegrationRouteDirective(decision)
    expect(directive).toContain('call Garden readDocument')
    expect(directive).toContain('Call tool_executor_execute for Decide')
    expect(directive).toContain('no integrations namespace')
    expect(directive).toContain(
      '`require`, Node built-ins, and an `integrations` object are not available',
    )
  })

  it('selects structured-data analysis for a CSV document with no analysis prose', () => {
    const decision = selectIntegrationRoute({
      userText: 'what is this?',
      documentContext: documentContext('revenue.csv'),
      catalog: CATALOG,
    })

    expect(decision.status).toBe('selected')
    expect(decision.routes[0]?.slug).toBe('decide')
    expect(decision.skill?.id).toBe('analyze-structured-data')
    expect(renderIntegrationRouteDirective(decision)).toContain(
      'call Garden readDocument',
    )
  })

  it('selects structured-data analysis for an XLSX document with no analysis prose', () => {
    const decision = selectIntegrationRoute({
      userText: 'what is this?',
      documentContext: documentContext('revenue.xlsx'),
      catalog: CATALOG,
    })

    expect(decision.status).toBe('selected')
    expect(decision.routes[0]?.slug).toBe('decide')
    expect(decision.skill?.id).toBe('analyze-structured-data')
    expect(renderIntegrationRouteDirective(decision)).toContain(
      'call Garden readDocument',
    )
  })

  it('does not route on document-context boilerplate alone', () => {
    const decision = selectIntegrationRoute({
      userText: 'what is this?',
      documentContext: documentContext('notes.pdf'),
      catalog: CATALOG,
    })

    expect(decision.status).toBe('none')
    expect(decision.skill).toBeNull()
  })

  it('routes email intent without naming the integration', () => {
    const decision = selectIntegrationRoute({
      userText: 'send an email to Ada about the launch',
      catalog: CATALOG,
    })

    expect(decision.status).toBe('selected')
    expect(decision.routes[0]?.slug).toBe('gmail')
  })

  it('routes a new provider from registered capabilities without router code', () => {
    const catalog: ExecutorCatalog = {
      integrations: [
        {
          slug: 'numbers-lab',
          name: 'Numbers Lab',
          description: 'A connected analysis service.',
          capabilities: [
            'analyze structured data',
            'create charts and reports',
          ],
        },
      ],
      connections: [
        {
          owner: 'user',
          integration: 'numbers-lab',
          name: 'numbers-lab',
          identityLabel: 'sam',
        },
      ],
      tools: [
        {
          name: 'inspect_table',
          description: 'Analyze structured data and create a chart.',
          integration: 'numbers-lab',
          connection: 'numbers-lab',
          owner: 'user',
          requiresApproval: false,
        },
      ],
    }

    const decision = selectIntegrationRoute({
      userText: 'analyze this sales file and make a chart',
      attachments: [{ filename: 'sales.csv', mediaType: 'text/csv' }],
      catalog,
    })

    expect(decision.status).toBe('selected')
    expect(decision.routes[0]?.slug).toBe('numbers-lab')
  })

  it('stays out of the way for unrelated chatter', () => {
    const decision = selectIntegrationRoute({
      userText: 'hey, how is it going?',
      catalog: CATALOG,
    })

    expect(decision.status).toBe('none')
    expect(decision.routes).toHaveLength(0)
  })

  it('does not force an integration for explanatory questions', () => {
    const decision = selectIntegrationRoute({
      userText: 'how do i analyze a csv in python?',
      catalog: CATALOG,
    })

    expect(decision.status).toBe('none')
  })

  it('keeps an explicitly named integration even when it is not connected', () => {
    const decision = selectIntegrationRoute({
      userText: 'check github issues for the garden repo',
      catalog: CATALOG,
    })

    expect(decision.status).toBe('selected')
    expect(decision.routes[0]).toMatchObject({
      slug: 'github',
      connected: false,
    })
    expect(renderIntegrationRouteDirective(decision)).toContain(
      'is not connected',
    )
  })

  it('renders a callable workflow and a no-silent-fallback rule', () => {
    const decision = selectIntegrationRoute({
      userText: 'analyze this',
      attachments: [{ filename: 'revenue.csv', mediaType: 'text/csv' }],
      catalog: CATALOG,
    })
    const directive = renderIntegrationRouteDirective(decision)

    expect(directive).toContain('Use Decide through Executor')
    expect(directive).toContain('Allowed tools: analyze_dataset')
    expect(directive).toContain(
      'Pass the complete text returned by readDocument',
    )
    expect(directive).toContain(
      'Do not pass a summary, sample, or truncated content',
    )
    expect(directive).toContain('reuse the session_id returned by Decide')
    expect(directive).toContain(
      'Render every text block from Decide in order and return generated report links when present',
    )
    expect(directive).toContain('Do not retry automatically')
    expect(directive).toContain('Do not silently replace it')
  })

  it('limits execution to the selected integration', () => {
    const decision = selectIntegrationRoute({
      userText: 'analyze this',
      attachments: [{ filename: 'revenue.csv', mediaType: 'text/csv' }],
      catalog: CATALOG,
    })

    expect(
      isIntegrationToolAllowed(decision, 'decide', 'analyze_dataset'),
    ).toBe(true)
    expect(isIntegrationToolAllowed(decision, 'decide', 'other_tool')).toBe(
      false,
    )
    expect(isIntegrationToolAllowed(decision, 'gmail', 'send_email')).toBe(
      false,
    )
  })
})

describe('connected-tool need detection', () => {
  it('skips readiness for plain chatter', () => {
    expect(
      requestNeedsConnectedTools(
        selectIntegrationRoute({
          userText: 'hey, how is it going?',
          catalog: CATALOG,
        }),
      ),
    ).toBe(false)
  })

  it('waits when a file or connector request arrives', () => {
    const decision = selectIntegrationRoute({
      userText: 'analyze this',
      attachments: [{ filename: 'revenue.csv', mediaType: 'text/csv' }],
      catalog: CATALOG,
    })
    expect(requestNeedsConnectedTools(decision)).toBe(true)
  })

  it('does not wait for an unrelated attachment', () => {
    const decision = selectIntegrationRoute({
      userText: 'describe this image',
      attachments: [{ filename: 'garden.png', mediaType: 'image/png' }],
      catalog: CATALOG,
    })

    expect(decision.status).toBe('none')
    expect(requestNeedsConnectedTools(decision)).toBe(false)
  })
})
