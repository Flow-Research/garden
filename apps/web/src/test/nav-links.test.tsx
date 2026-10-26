import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@garden/core/types'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import AgentsPage from '@/features/agents/components/agents-page'
import { AgentDetail } from '@/features/agents/components/agent-detail'
import { AutomationsPage } from '@/features/automations/automations-page'
import { automationKeys } from '@/features/automations/queries'
import { workspaceKeys } from '@/lib/workspace/queries'

/**
 * Rows that navigate are links, so they can be middle-clicked or opened in a
 * new tab; a plain click still navigates in-app.
 */

function renderWith(seed: (queryClient: QueryClient) => void, ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  seed(queryClient)
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">{ui}</WorkspaceIdProvider>
    </QueryClientProvider>,
  )
}

describe('navigating rows are links', () => {
  it('agent cards', () => {
    const onOpenAgent = vi.fn()
    const agent = {
      id: 'agent-1',
      name: 'Garden',
      status: 'idle',
      archived_at: null,
      description: null,
    } as unknown as Agent
    renderWith(
      (qc) => qc.setQueryData(workspaceKeys.agents('ws-1'), [agent]),
      <AgentsPage onOpenAgent={onOpenAgent} />,
    )

    const link = screen.getByRole('link', { name: /Garden/ })
    expect(link).toHaveAttribute('href', '/agents/agent-1')
    fireEvent.click(link, { ctrlKey: true })
    expect(onOpenAgent).not.toHaveBeenCalled()
    fireEvent.click(link)
    expect(onOpenAgent).toHaveBeenCalledWith(agent)
  })

  it('automation rows', () => {
    const onOpenAutomation = vi.fn()
    renderWith(
      (qc) =>
        qc.setQueryData(automationKeys.list('ws-1'), {
          automations: [
            {
              id: 'auto-1',
              title: 'Daily digest',
              status: 'active',
              assignee_agent_name: 'Garden',
              last_run_at: null,
            },
          ],
        }),
      <AutomationsPage onOpenAutomation={onOpenAutomation} />,
    )

    const link = screen.getByRole('link', { name: /Daily digest/ })
    expect(link).toHaveAttribute('href', '/workflows/auto-1')
    fireEvent.click(link, { metaKey: true })
    expect(onOpenAutomation).not.toHaveBeenCalled()
    fireEvent.click(link)
    expect(onOpenAutomation).toHaveBeenCalledTimes(1)
  })
})

describe('view state in the URL', () => {
  it('agent detail shows the tab it is given and reports tab changes', () => {
    const onTabChange = vi.fn()
    renderWith(
      (qc) => {
        qc.setQueryData(workspaceKeys.agent('agent-1'), {
          id: 'agent-1',
          name: 'Garden',
          status: 'idle',
        })
        qc.setQueryData(workspaceKeys.members('ws-1'), [])
      },
      <AgentDetail
        agentId="agent-1"
        onOpenSkill={vi.fn()}
        tab="overview"
        onTabChange={onTabChange}
      />,
    )

    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Skills' }))
    expect(onTabChange).toHaveBeenCalledWith('skills')
  })
})
