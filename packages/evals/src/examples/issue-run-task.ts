import { taskDefinitionSchema } from '../index.ts'

export const issueRunTaskExample = taskDefinitionSchema.parse({
  taskId: 'durability.issue-run-status-succeeds',
  version: 1,
  suite: 'durability',
  surface: 'issue_run',
  fixture: { fixtureId: 'issue-run-status-v1', version: 1 },
  title: 'Complete a short issue-run task',
  prompt: 'Write a short completion summary for this evaluation issue.',
  input: {},
  capabilities: {
    connectors: [],
    permissions: [],
  },
  successCriteria: [
    {
      criterionId: 'run-succeeded',
      graderId: 'issue-run-status-equals',
      description: 'The issue run ends with status succeeded.',
      expected: { status: 'succeeded' },
      requiredEvidence: ['issue_run'],
    },
  ],
})
