// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ExecutorCatalog } from './executor-runtime'
import { executorToolsForCapabilitySync } from './capability-sync'

const orgTool = {
  address: 'tools.google_drive.org.company.list_files',
  name: 'list_files',
  description: 'List files',
  integration: 'google_drive',
  connection: 'company',
  owner: 'org',
  requiresApproval: false,
  mayElicit: false,
} satisfies ExecutorCatalog['tools'][number]

describe('Executor capability discovery', () => {
  it('includes an org-only connection without a personal duplicate', () => {
    expect(executorToolsForCapabilitySync([orgTool], 'google_drive')).toEqual([
      orgTool,
    ])
  })

  it('keeps the stricter catalog approval for a shared tool name', () => {
    const personalTool = {
      ...orgTool,
      address: 'tools.google_drive.user.personal.list_files',
      connection: 'personal',
      owner: 'user',
      requiresApproval: true,
    } satisfies ExecutorCatalog['tools'][number]

    expect(
      executorToolsForCapabilitySync([personalTool, orgTool], 'google_drive'),
    ).toEqual([personalTool])
    expect(
      executorToolsForCapabilitySync([orgTool, personalTool], 'google_drive'),
    ).toEqual([personalTool])
  })
})
