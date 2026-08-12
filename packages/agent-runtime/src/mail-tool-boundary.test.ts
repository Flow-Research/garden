import { describe, expect, it } from 'vitest'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import {
  executorMcpResourceForRuntime,
  inboxActiveToolKeys,
  toolsForChatRuntime,
} from './mail-tool-boundary'

const inertTool = () => tool({ inputSchema: z.object({}) })

describe('Inbox agent tool boundary', () => {
  it('keeps ordinary chat tools unchanged and excludes mail tools', () => {
    const chatTools = {
      askUserInput: inertTool(),
      execute: inertTool(),
      create_issue: inertTool(),
      sandboxExec: inertTool(),
    } satisfies ToolSet
    const tools = toolsForChatRuntime({
      inboxRuntime: false,
      chatTools,
    })

    expect(tools).toBe(chatTools)
    expect(Object.keys(tools)).toEqual([
      'askUserInput',
      'execute',
      'create_issue',
      'sandboxExec',
    ])
  })

  it('exposes no first-party server tools in Inbox', () => {
    const tools = toolsForChatRuntime({
      inboxRuntime: true,
      chatTools: {
        askUserInput: inertTool(),
        execute: inertTool(),
        propose_agent: inertTool(),
        create_issue: inertTool(),
        list_issues: inertTool(),
        webSearch: inertTool(),
        sandboxExec: inertTool(),
        listDocuments: inertTool(),
        mail_create_draft: inertTool(),
        mail_save_draft: inertTool(),
        mail_request_draft_delivery: inertTool(),
      },
    })

    expect(Object.keys(tools)).toEqual([])
  })

  it('selects Executor toolkit only for the Inbox facet', () => {
    expect(
      executorMcpResourceForRuntime({
        inboxRuntime: true,
        toolkitSlug: 'garden-mail-174e67d2-bcbc-420b-a1f5-289ee6681b8f',
      }),
    ).toEqual({
      kind: 'toolkit',
      slug: 'garden-mail-174e67d2-bcbc-420b-a1f5-289ee6681b8f',
    })
    expect(
      executorMcpResourceForRuntime({
        inboxRuntime: false,
        toolkitSlug: null,
      }),
    ).toEqual({ kind: 'default' })
  })

  it('activates only browser compose and scoped Executor MCP', () => {
    expect(
      inboxActiveToolKeys({
        assembledTools: {
          compose_mail: inertTool(),
          askUserInput: inertTool(),
          workspace_read_file: inertTool(),
          create_issue: inertTool(),
          mail_read_conversation: inertTool(),
        },
        stableMcpTools: {
          tool_executor_execute: inertTool(),
          tool_executor_skills: inertTool(),
          tool_executor_resume: inertTool(),
          tool_foreign_server_delete_everything: inertTool(),
        },
      }),
    ).toEqual([
      'compose_mail',
      'tool_executor_execute',
      'tool_executor_skills',
      'tool_executor_resume',
    ])
  })
})
