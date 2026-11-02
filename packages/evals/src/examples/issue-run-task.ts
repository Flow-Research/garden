import { taskDefinitionSchema } from '../index.js'

export const issueRunTaskExample = taskDefinitionSchema.parse({
  taskId: 'durability.issue-run-reaches-succeeded',
  version: 1,
  suite: 'durability',
  surface: 'issue_run',
  fixture: { fixtureId: 'basic-issue-run-v1', version: 1 },
  title: 'An issue run reaches its requested terminal state',
  prompt: 'Complete the work described in this issue.',
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
