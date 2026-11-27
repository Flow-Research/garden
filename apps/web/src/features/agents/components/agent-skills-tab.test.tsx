import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Skill } from '@garden/core/types'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { workspaceKeys } from '@/lib/workspace/queries'
import { AgentSkillsTab } from './agent-skills-tab'

const api = vi.hoisted(() => ({
  setAgentSkills: vi.fn(),
  listAgentSkills: vi.fn(async () => []),
  listSkills: vi.fn(),
  getAgent: vi.fn(async () => ({ id: 'agent-1', permissions: null })),
  updateAgentPermissions: vi.fn(),
}))
vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  api,
}))

const SKILL = {
  id: 'skill-1',
  slug: 'release-notes',
  name: 'Release notes',
  description: null,
} as unknown as Skill

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryData(workspaceKeys.agentSkills('ws-1', 'agent-1'), [])
  queryClient.setQueryData(workspaceKeys.skills('ws-1'), [SKILL])
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">
        <AgentSkillsTab agentId="agent-1" onOpenSkill={vi.fn()} />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
}

async function attachReleaseNotes() {
  fireEvent.click(await screen.findByRole('button', { name: 'Attach skill' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: /Release notes/ }))
  fireEvent.click(within(dialog).getByRole('button', { name: /^Attach/ }))
}

describe('AgentSkillsTab attach', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not say the skill was attached when saving failed', async () => {
    api.setAgentSkills.mockRejectedValue(new Error('Save failed'))
    const success = vi.spyOn(toast, 'success')
    const error = vi.spyOn(toast, 'error')
    renderTab()

    await attachReleaseNotes()

    await waitFor(() => expect(error).toHaveBeenCalledWith('Save failed'))
    expect(success).not.toHaveBeenCalled()
  })

  it('says the skill was attached once it saved', async () => {
    api.setAgentSkills.mockResolvedValue(undefined)
    const success = vi.spyOn(toast, 'success')
    renderTab()

    await attachReleaseNotes()

    await waitFor(() => expect(success).toHaveBeenCalledWith('Skill attached'))
  })
})
