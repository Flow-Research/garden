import process from 'node:process'
import { requiredEnv } from './db.ts'

export type FixtureTarget =
  | 'chat'
  | 'issue-run'
  | 'issue-run-work'
  | 'automation-run'
  | 'automation-schedule'

export async function callAgentRuntimeFixture(input: {
  message?: string
  messages?: string[]
  mode: 'inspect' | 'run'
  target: FixtureTarget
  userId: string
  workspaceId: string
}) {
  const baseUrl =
    process.env.GARDEN_FIXTURE_URL ??
    `http://127.0.0.1:${process.env.PORT ?? '3000'}`
  const response = await fetch(`${baseUrl}/api/dev/chat-agent-fixture`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-garden-internal-secret': requiredEnv('BETTER_AUTH_SECRET'),
    },
    body: JSON.stringify(input),
  })
  const text = await response.text()
  if (!response.ok)
    throw new Error(`Fixture failed ${response.status}: ${text}`)
  return JSON.parse(text)
}
