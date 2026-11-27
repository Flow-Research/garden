import type { TaskDefinition } from '../index.ts'

export const decideCsvRows = [
  ['date', 'region', 'plan', 'units', 'revenue', 'satisfaction'],
  ['2026-01-07', 'North', 'Analytics Pro', '12', '3600', '4.5'],
  ['2026-02-11', 'West', 'Starter', '8', '1200', '4.0'],
  ['2026-03-18', 'ast', 'Analytics Pro', '34', '10200', '4.3'],
  ['2026-04-22', 'South', 'Analytics Pro', '9', '2700', '4.6'],
  ['2026-05-14', 'East', 'Starter', '10', '1500', '4.2'],
] as const

export const decideCsvFixture = `${decideCsvRows
  .map((row) => row.join(','))
  .join('\n')}\n`

export const decideCsvTask: TaskDefinition & { surface: 'chat' } = {
  taskId: 'artifacts.decide-csv-workbook',
  version: 1,
  suite: 'artifacts',
  surface: 'chat',
  fixture: { fixtureId: 'synthetic-sales-csv-v1', version: 1 },
  title: 'Inspect a CSV and create a verification workbook',
  prompt: [
    'Inspect the attached CSV exactly as received. Do not correct or normalize any values.',
    'Create an Excel workbook with three sheets: Raw Data, Verification, and Analysis.',
    'Copy all source rows to Raw Data. In Verification, copy the complete 2026-03-18 row, list every distinct region, and state whether ast appears in the source.',
    'In Analysis, summarize the data and report any possible typo. Keep the original value and proposed correction separate.',
  ].join(' '),
  input: {
    filename: 'garden-eval-sales.csv',
    mediaType: 'text/csv',
  },
  capabilities: { connectors: ['decide'], permissions: [] },
  successCriteria: [
    {
      criterionId: 'one-decide-run-completed',
      graderId: 'decide-run-completed-once',
      description: 'The chat starts and completes exactly one Decide analysis.',
      expected: { status: 'completed', runCount: 1 },
      requiredEvidence: ['chat_thread', 'decide_analysis'],
    },
    {
      criterionId: 'workbook-has-required-sheets',
      graderId: 'decide-workbook-sheets',
      description:
        'The generated workbook opens and has all three required sheets.',
      expected: { sheets: ['Raw Data', 'Verification', 'Analysis'] },
      requiredEvidence: ['decide_workbook'],
    },
    {
      criterionId: 'raw-data-is-preserved',
      graderId: 'decide-workbook-raw-data',
      description: 'The Raw Data sheet preserves every source row and cell.',
      expected: { rows: decideCsvRows.length },
      requiredEvidence: ['decide_workbook'],
    },
    {
      criterionId: 'verification-matches-source',
      graderId: 'decide-workbook-verification',
      description:
        'The Verification sheet shows the raw row, all regions, and ast presence.',
      expected: {
        date: '2026-03-18',
        regions: ['North', 'West', 'ast', 'South', 'East'],
      },
      requiredEvidence: ['decide_workbook'],
    },
    {
      criterionId: 'analysis-keeps-correction-separate',
      graderId: 'decide-workbook-analysis',
      description:
        'The Analysis sheet names ast as the original value and East as the proposed correction.',
      expected: { original: 'ast', proposed: 'East' },
      requiredEvidence: ['decide_workbook'],
    },
  ],
}

export const uploadedBriefFixture = [
  '# Lark migration',
  '',
  '- Owner: Maya Okafor',
  '- Launch date: 2026-12-14',
  '- Open risk: security approval is pending.',
  '',
].join('\n')

export const uploadedBriefTask: TaskDefinition & { surface: 'chat' } = {
  taskId: 'answers.uploaded-brief-facts',
  version: 2,
  suite: 'collaboration',
  surface: 'chat',
  fixture: { fixtureId: 'synthetic-project-brief-v1', version: 1 },
  title: 'Summarize the facts in an uploaded project brief',
  prompt:
    'Read the attached project brief. Summarize the project in one sentence. Include the owner and launch date.',
  input: { filename: 'lark-migration-brief.md', mediaType: 'text/markdown' },
  capabilities: { connectors: [], permissions: [] },
  successCriteria: [
    {
      criterionId: 'decide-is-not-used-for-brief-facts',
      graderId: 'decide-run-absent',
      description:
        'Garden answers from the brief without starting a Decide analysis.',
      expected: { runCount: 0 },
      requiredEvidence: ['chat_thread', 'decide_analysis'],
    },
    {
      criterionId: 'answer-uses-owner-and-date',
      graderId: 'chat-answer-includes-fixture-facts',
      description:
        'The answer includes the owner and the launch date from the uploaded brief.',
      expected: { values: ['Maya Okafor', '2026-12-14'] },
      requiredEvidence: ['chat_thread', 'assistant_response'],
    },
  ],
}

export type ChatEvalTask = {
  definition: TaskDefinition & { surface: 'chat' }
  filename: string
  mediaType: string
  contents: string
}

export const chatEvalTasks = new Map<string, ChatEvalTask>([
  [
    decideCsvTask.taskId,
    {
      definition: decideCsvTask,
      filename: 'garden-eval-sales.csv',
      mediaType: 'text/csv',
      contents: decideCsvFixture,
    },
  ],
  [
    uploadedBriefTask.taskId,
    {
      definition: uploadedBriefTask,
      filename: 'lark-migration-brief.md',
      mediaType: 'text/markdown',
      contents: uploadedBriefFixture,
    },
  ],
])
