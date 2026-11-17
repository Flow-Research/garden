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
    expect(directive).toContain('Call decide_analyze')
    expect(directive).toContain('Do not use Executor execute for Decide')
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

    expect(directive).toContain('Use the direct Decide tools')
    expect(directive).toContain('Do not use Executor execute for Decide')
    expect(directive).toContain('Call decide_analyze')
    expect(directive).not.toContain('Allowed tools: analyze_dataset')
    expect(directive).toContain(
      'Pass the complete text returned by readDocument',
    )
    expect(directive).toContain(
      'Do not pass a summary, sample, or truncated content',
    )
    expect(directive).toContain('source { "kind": "brain_file"')
    expect(directive).not.toContain('text returned by brain_read_file')
    expect(directive).toContain('its answer arrives later in this chat')
    expect(directive).toContain('Never poll, retry, or wait')
    expect(directive).toContain('never substitute a local analysis')
    expect(directive).toContain('Never mention run IDs or session IDs')
    expect(directive).not.toContain('session_id')
    expect(directive).not.toContain('Render every text block')
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

const WORKSTREAM_CATALOG: ExecutorCatalog = {
  integrations: [
    ...CATALOG.integrations,
    {
      slug: 'workstream',
      name: 'Workstream',
      description: 'Governed work and contribution evidence.',
      capabilities: [],
    },
  ],
  connections: [
    ...CATALOG.connections,
    { owner: 'user', integration: 'workstream', name: 'workstream' },
  ],
  tools: [
    ...CATALOG.tools,
    ...[
      'workstream_active_guide_get',
      'workstream_actor_admin_grants_list',
      'workstream_actor_assignments_list',
      'workstream_actor_deactivate',
      'workstream_actor_get',
      'workstream_actor_identity_link_get',
      'workstream_actor_projects_list',
      'workstream_actor_reactivate',
      'workstream_admin_grants_list',
      ...Array.from(
        { length: 122 },
        (_, index) => `workstream_catalogue_${String(index).padStart(3, '0')}`,
      ),
      'workstream_profile_get',
    ].map((name) => ({
      name,
      description:
        name === 'workstream_profile_get'
          ? "Read the authenticated caller's Workstream profile."
          : 'Inspect Workstream governance information.',
      integration: 'workstream',
      connection: 'workstream',
      owner: 'user' as const,
      requiresApproval: true,
    })),
  ],
}

const PROFILE_TOOL = 'workstream_profile_get'
const ADMIN_READ_TOOL = 'workstream_admin_grants_list'

describe('integration router tool relevance', () => {
  it.each([
    `Use Workstream. Call ${PROFILE_TOOL} with {} and ${ADMIN_READ_TOOL} with {"scope_type":"system","limit":1}.`,
    `Use Workstream. Call tools.workstream.user.workstream.${PROFILE_TOOL}({}) and tools.workstream.user.workstream.${ADMIN_READ_TOOL}({scope_type:"system",limit:1}).`,
  ])('retains explicitly requested discovered tools: %s', (userText) => {
    expect(
      WORKSTREAM_CATALOG.tools.filter(
        (tool) => tool.integration === 'workstream',
      ),
    ).toHaveLength(132)
    const decision = selectIntegrationRoute({
      userText,
      catalog: WORKSTREAM_CATALOG,
    })
    expect(decision.status).toBe('selected')
    const allowed = decision.routes[0]?.allowedToolNames ?? []
    expect(allowed.slice(0, 2)).toEqual(
      expect.arrayContaining([PROFILE_TOOL, ADMIN_READ_TOOL]),
    )
    expect(allowed).toHaveLength(8)
    expect(isIntegrationToolAllowed(decision, 'workstream', PROFILE_TOOL)).toBe(
      true,
    )
    expect(
      isIntegrationToolAllowed(decision, 'workstream', ADMIN_READ_TOOL),
    ).toBe(true)
    expect(renderIntegrationRouteDirective(decision)).toContain(PROFILE_TOOL)
    expect(renderIntegrationRouteDirective(decision)).toContain(ADMIN_READ_TOOL)
  })

  it('ranks meaningful profile matches ahead of the shared provider prefix', () => {
    const decision = selectIntegrationRoute({
      userText: 'Use Workstream to read my authenticated caller profile.',
      catalog: WORKSTREAM_CATALOG,
    })
    expect(decision.routes[0]?.allowedToolNames[0]).toBe(PROFILE_TOOL)
  })

  it.each([
    `${PROFILE_TOOL}_unavailable`,
    `${PROFILE_TOOL}-unavailable`,
    `unavailable-${PROFILE_TOOL}`,
  ])(
    'keeps the eight-tool cap without exact-matching part of %s',
    (unavailable) => {
      const requested = Array.from(
        { length: 8 },
        (_, index) =>
          `workstream_catalogue_${String(100 + index).padStart(3, '0')}`,
      )
      const decision = selectIntegrationRoute({
        userText: `Use Workstream. Call ${requested.join(', ')} and ${unavailable}.`,
        catalog: WORKSTREAM_CATALOG,
      })
      const allowed = decision.routes[0]?.allowedToolNames ?? []
      expect(allowed).toHaveLength(8)
      expect(allowed).toEqual(expect.arrayContaining(requested))
      expect(allowed).not.toContain(PROFILE_TOOL)
      expect(allowed).not.toContain(unavailable)
      expect(
        isIntegrationToolAllowed(decision, 'workstream', unavailable),
      ).toBe(false)
    },
  )

  it('does not admit another connected provider into the selected scope', () => {
    const decision = selectIntegrationRoute({
      userText: `Use Workstream and call ${PROFILE_TOOL}.`,
      catalog: WORKSTREAM_CATALOG,
    })
    expect(decision.routes[0]?.slug).toBe('workstream')
    expect(isIntegrationToolAllowed(decision, 'gmail', 'send_email')).toBe(
      false,
    )
    expect(decision.routes[0]?.allowedToolNames).not.toContain('send_email')
  })
})

const COMPETING_CATALOG: ExecutorCatalog = {
  integrations: [
    ...WORKSTREAM_CATALOG.integrations,
    {
      slug: 'executor',
      name: 'Executor',
      description:
        'Manage integrations and connections in the workspace catalog.',
      capabilities: [],
    },
  ],
  connections: [
    ...WORKSTREAM_CATALOG.connections,
    { owner: 'user', integration: 'executor', name: 'core' },
  ],
  tools: [
    ...WORKSTREAM_CATALOG.tools,
    {
      name: 'integrations.list',
      description:
        'List integrations in the workspace catalog (slug, description, owning plugin kind). Connections authenticate against these.',
      integration: 'executor',
      connection: 'core',
      owner: 'user',
      requiresApproval: false,
    },
    {
      name: 'policies.create',
      description:
        'Create a tool policy. pattern matches a tool address tail; action is approve/require_approval/block. owner is org (workspace guardrail) or user (personal).',
      integration: 'executor',
      connection: 'core',
      owner: 'user',
      requiresApproval: true,
    },
    {
      name: 'connections.createHandoff',
      description:
        'Return a browser URL that opens the Add account flow for one integration. Use this for API keys/tokens so the user enters secrets directly in the web UI instead of sending them through the agent. Optionally preselect owner, auth template, and a non-secret label.',
      integration: 'executor',
      connection: 'core',
      owner: 'user',
      requiresApproval: false,
    },
    {
      name: 'connections.remove',
      description:
        'Remove a saved connection and its produced tools by owner, integration, and connection name.',
      integration: 'executor',
      connection: 'core',
      owner: 'user',
      requiresApproval: true,
    },
  ],
}

describe('explicit tool integration selection', () => {
  it('selects the named tool owner despite competing Executor terminology', () => {
    const decision = selectIntegrationRoute({
      catalog: COMPETING_CATALOG,
      userText:
        'Restore the dedicated isolation participant now. Use Executor once: const result = await tools.workstream.user.workstream.workstream_actor_reactivate({actor_profile_id: "test-actor", body: {reason: "Restore isolation test participant after authorized Garden suspension proof"}, idempotency_key: "test-key"}); emit(result); return result; Do not change any other account or retry. If approval is required show its execution ID for confirmation.',
    })
    expect(decision.status).toBe('selected')
    expect(decision.routes[0]?.slug).toBe('workstream')
    expect(
      isIntegrationToolAllowed(
        decision,
        'workstream',
        'workstream_actor_reactivate',
      ),
    ).toBe(true)
    expect(
      isIntegrationToolAllowed(decision, 'executor', 'connections.remove'),
    ).toBe(false)
    expect(decision.routes[0]?.allowedToolNames).toHaveLength(8)
  })
  it('retains explicit Executor management requests', () => {
    const decision = selectIntegrationRoute({
      catalog: COMPETING_CATALOG,
      userText:
        'Use Executor integrations.list to inspect my Workstream connection.',
    })
    expect(decision.status).toBe('selected')
    expect(decision.routes[0]?.slug).toBe('executor')
    expect(
      isIntegrationToolAllowed(decision, 'executor', 'integrations.list'),
    ).toBe(true)
  })
  it('keeps a named tool owner disconnected when no caller connection exists', () => {
    const decision = selectIntegrationRoute({
      catalog: {
        ...COMPETING_CATALOG,
        connections: COMPETING_CATALOG.connections.filter(
          (connection) => connection.integration !== 'workstream',
        ),
      },
      userText: 'Use Executor to call workstream_actor_reactivate.',
    })
    expect(decision.routes[0]).toMatchObject({
      slug: 'workstream',
      connected: false,
    })
    expect(requestNeedsConnectedTools(decision)).toBe(false)
    expect(renderIntegrationRouteDirective(decision)).toContain(
      'Ask the user to connect it.',
    )
  })

  it('does not select one owner when exact tools name two integrations', () => {
    const decision = selectIntegrationRoute({
      catalog: COMPETING_CATALOG,
      userText: 'Call workstream_actor_reactivate and integrations.list.',
    })
    expect(decision.status).toBe('none')
  })
  it('retains both exact owners when an attachment selects a different skill', () => {
    const decision = selectIntegrationRoute({
      catalog: CATALOG,
      userText: 'Call analyze_dataset and send_email.',
      attachments: [{ filename: 'revenue.csv', mediaType: 'text/csv' }],
    })
    expect(decision.status).toBe('none')
    expect(decision.routes.map((route) => route.slug)).toEqual(
      expect.arrayContaining(['decide', 'gmail']),
    )
  })

  it('does not promote an unavailable tool name over a real exact request', () => {
    const decision = selectIntegrationRoute({
      catalog: COMPETING_CATALOG,
      userText:
        'Call workstream_actor_reactivate_unavailable and integrations.list.',
    })
    expect(decision.status).toBe('selected')
    expect(decision.routes[0]?.slug).toBe('executor')
    expect(decision.routes[0]?.allowedToolNames).not.toContain(
      'workstream_actor_reactivate_unavailable',
    )
  })
})
