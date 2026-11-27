import { appendFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Result } from 'better-result'
import { stepCountIs, streamText, tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { createWorkersAI } from 'workers-ai-provider'
import { assembleFoundationPrompt } from '../src/prompt'

const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url))
if (existsSync(rootEnvPath)) loadEnvFile(rootEnvPath)

const runCount = process.argv[2] === undefined ? 3 : Number(process.argv[2])
if (!Number.isSafeInteger(runCount) || runCount < 1) {
  console.error('N must be a positive integer.')
  process.exit(1)
}
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const apiKey = process.env.CLOUDFLARE_API_TOKEN
if (!accountId || !apiKey) {
  console.error(
    'Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in root .env.',
  )
  process.exit(1)
}

const MODEL_ID = '@cf/deepseek-ai/deepseek-v4.1-flash-1017'
const workersai = createWorkersAI({
  accountId,
  apiKey,
  ...(process.env.AI_GATEWAY_ID?.trim()
    ? { gateway: { id: process.env.AI_GATEWAY_ID.trim() } }
    : {}),
})
const model = workersai(MODEL_ID, { reasoning_effort: 'high' })
const SYSTEM_PROMPT = assembleFoundationPrompt()
const outputDirectory = fileURLToPath(
  new URL('../benchmarks/step-output/', import.meta.url),
)
const outputPath = join(
  outputDirectory,
  `${new Date().toISOString().slice(0, 10)}-deepseek-v4.1-flash-high.jsonl`,
)

const guideSections = [
  '## Goals and success measures\nGoal: give operations teams an auditable view of decisions. Milestone: ship workspace summaries and exports. Risk: users may treat derived summaries as source records. API: GET /api/workspaces/{workspaceId}/summary.',
  '## Architecture and service boundaries\nGoal: keep browser, application service, and persistence roles clear. Milestone: publish ownership and dependency maps. Risk: shared modules may gain unowned business rules. API: ProjectReader feeds a versioned WorkspaceSummary service.',
  '## Delivery milestones\nGoal: release measurable changes that can be rolled back. Milestone: complete preview, partner pilot, then general release. Risk: partner feedback may overlap migration freeze. API: GET /api/releases/{releaseId} returns status and evidence.',
  '## Data model and migrations\nGoal: preserve project identifiers while adding summary metadata. Milestone: backfill, verify counts, then enable cohort reads. Risk: partial backfills can split totals. API: POST /api/admin/migrations/{migrationId}/verify.',
  '## Public and internal APIs\nGoal: keep responses bounded and safe to cache. Milestone: freeze v1 after client and compatibility reviews. Risk: optional fields can break strict clients. API: GET /api/projects/{projectId}/guide returns stable section ids.',
  '## Permissions and security\nGoal: show users only workspaces allowed by active membership. Milestone: finish role tests and threat review. Risk: cached summaries may outlive membership. API: the resolver checks access before cache lookup.',
  '## Reliability and operations\nGoal: keep dependencies visible and the summary path within its service target. Milestone: add dashboards, alerts, and rollback runbooks. Risk: retries can add load during an outage. API: GET /health/summary reports dependency state.',
  '## Testing, risks, and rollout\nGoal: prove sections against source records and keep useful empty states. Milestone: run contract, migration, accessibility, and load checks. Risk: fixtures may hide older fields. API: acceptance reports store fixture, revision, owner, and result.',
]

function makeProjectGuide() {
  let guide = `# Atlas Project Guide\n\n${guideSections.join('\n\n')}`
  for (let index = 0; guide.length < 30_000; index += 1) {
    const title = guideSections[index % guideSections.length]
      .split('\n')[0]
      .slice(3)
    const cycle = Math.floor(index / guideSections.length) + 1
    guide += `\n\nReview ${cycle} for ${title}: confirm source revision, response schema, failure mode, cache behavior, and cohort. Compare evidence with the milestone, record risk changes, and update the runbook before the release gate.`
  }
  return guide
}

const projectGuide = makeProjectGuide()
const repoGuide =
  '# Repository guide\n\nThe web application reads summaries through the workspace summary service. The service owns response shaping and source links. ProjectReader owns persistence queries. API handlers validate membership before reading data. Migrations come from the schema and require a row-count check. The release runbook requires a cohort flag, dashboard review, and rollback owner.'
const issueReports =
  'Bug A: summaries show an old owner after membership changes, but the project page is correct after refresh.\nBug B: export omits risks with a review date but no status, while the API returns them.\nBug C: failed refresh leaves a spinner until reload; the endpoint returns 503 and a retry hint.'
const searchFacts = [
  'Queue recovery uses an idempotency key per refresh. Duplicate delivery returns the stored result and does not enqueue another refresh.',
  'The summary cache uses workspace and membership revisions. A membership change invalidates entries for that workspace.',
  'Permission checks run before cache lookup. The caller needs active workspace membership and a project read role.',
  'The refresh worker records duration and failure counters. Alerts use sustained error rate to avoid paging on one failed job.',
  'Schema changes use generated migrations. The rollout verifies row counts before enabling reads for a cohort.',
  'The API returns a retry hint for temporary store failures. Clients keep the last confirmed summary visible while waiting.',
]

const longReportTools: ToolSet = {
  read_document: tool({
    description: 'Read the complete Atlas project guide by document id.',
    inputSchema: z.object({ documentId: z.string() }),
    execute: async () => ({ documentId: 'atlas-guide', text: projectGuide }),
  }),
  read_repo_file: tool({
    description: 'Read a short repository source file by path.',
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => ({ path, text: repoGuide }),
  }),
}
const normalIssueTools: ToolSet = {
  read_bug_reports: tool({
    description: 'Read the three current bug reports.',
    inputSchema: z.object({ reportSet: z.string() }),
    execute: async () => ({ reports: issueReports }),
  }),
}
let searchCalls = 0
const toolLoopTools: ToolSet = {
  search: tool({
    description:
      'Search project notes for one topic and return matching evidence.',
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      const result = searchFacts[searchCalls % searchFacts.length]
      searchCalls += 1
      return { query, source: `project-notes/${searchCalls}.md`, result }
    },
  }),
}

type TaskName = 'long_report' | 'normal_issue' | 'tool_loop'

async function appendRows<T extends { modelId: string }>(rows: T[]) {
  await appendFile(
    outputPath,
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
  )
}

async function measureRun(
  task: TaskName,
  runIndex: number,
  prompt: string,
  tools: ToolSet,
) {
  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    prompt,
    tools,
    stopWhen: stepCountIs(30),
  })
  const steps = []
  const newStep = () => ({
    stepIndex: steps.length,
    startedAt: performance.now(),
    textDeltaParts: 0,
    reasoningDeltaParts: 0,
    textChars: 0,
    reasoningChars: 0,
  })
  let activeStep: ReturnType<typeof newStep> | undefined

  for await (const part of result.fullStream) {
    if (part.type === 'start-step') {
      activeStep = newStep()
      continue
    }
    if (part.type === 'text-delta') {
      const step = activeStep ?? (activeStep = newStep())
      step.textDeltaParts += 1
      step.textChars += part.text.length
    } else if (part.type === 'reasoning-delta') {
      const step = activeStep ?? (activeStep = newStep())
      step.reasoningDeltaParts += 1
      step.reasoningChars += part.text.length
    } else if (part.type === 'finish-step') {
      const step = activeStep ?? newStep()
      const { startedAt, ...metrics } = step
      steps.push({
        ...metrics,
        rowType: 'step',
        task,
        runIndex,
        modelId: MODEL_ID,
        finishReason: part.finishReason,
        outputTokens: part.usage.outputTokens ?? null,
        reasoningTokens:
          part.usage.outputTokenDetails.reasoningTokens ??
          part.usage.reasoningTokens ??
          null,
        inputTokens: part.usage.inputTokens ?? null,
        durationMs: Math.round(performance.now() - startedAt),
      })
      activeStep = undefined
    }
  }

  const finalText = await result.text
  const runRow = {
    rowType: 'run',
    task,
    runIndex,
    modelId: MODEL_ID,
    totalSteps: steps.length,
    finalTextLength: finalText.length,
    finalTextEmpty: finalText.length === 0,
  }
  await appendRows([...steps, runRow])
  return { steps, runRow }
}

type StepRow = Awaited<ReturnType<typeof measureRun>>['steps'][number]

function makeSummary(task: TaskName, steps: StepRow[]) {
  const outputs = steps
    .map((step) => step.outputTokens)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)
  const percentile = (fraction: number) =>
    outputs[Math.max(0, Math.ceil(outputs.length * fraction) - 1)] ?? null
  const totalOutput = outputs.reduce((sum, value) => sum + value, 0)
  const reasoning = steps.flatMap(({ reasoningTokens }) =>
    reasoningTokens === null ? [] : [reasoningTokens],
  )
  const totalReasoning = reasoning.reduce((sum, value) => sum + value, 0)
  const deltaParts = steps.reduce(
    (sum, step) => sum + step.textDeltaParts + step.reasoningDeltaParts,
    0,
  )
  return {
    task,
    p50OutputTokens: percentile(0.5),
    p95OutputTokens: percentile(0.95),
    maxOutputTokens: outputs.at(-1) ?? null,
    reasoningShare:
      totalOutput && reasoning.length === steps.length && steps.length > 0
        ? `${((totalReasoning / totalOutput) * 100).toFixed(1)}%`
        : 'n/a',
    tokensPerDeltaPart: deltaParts
      ? (totalOutput / deltaParts).toFixed(2)
      : 'n/a',
  }
}

async function run() {
  await mkdir(outputDirectory, { recursive: true })
  const tasks: Array<[TaskName, string, ToolSet]> = [
    [
      'long_report',
      'Write a complete reconciliation report. Read atlas-guide with read_document, then read the project entry file with read_repo_file. Use a heading for every guide section. State goals, evidence, milestones, owners, risks, APIs, migration checks, release gates, and constraints.',
      longReportTools,
    ],
    [
      'normal_issue',
      'Read reportSet current. Summarize the three bug reports and propose a fix order. Give one short reason for each position and note dependencies.',
      normalIssueTools,
    ],
    [
      'tool_loop',
      'Use search 4 to 6 times with distinct queries about queue recovery, cache invalidation, permissions, observability, migrations, and retry behavior. Recommend next steps and cite each source path.',
      toolLoopTools,
    ],
  ]
  const allSteps: Record<TaskName, StepRow[]> = {
    long_report: [],
    normal_issue: [],
    tool_loop: [],
  }
  for (const [task, prompt, tools] of tasks) {
    for (let runIndex = 1; runIndex <= runCount; runIndex += 1) {
      const { steps } = await measureRun(task, runIndex, prompt, tools)
      allSteps[task].push(...steps)
    }
  }

  const puzzle = streamText({
    model,
    system: SYSTEM_PROMPT,
    maxOutputTokens: 300,
    prompt:
      'Coins A through L contain one counterfeit coin, which may be heavy or light. With a balance scale and exactly three weighings, give a complete strategy that identifies the coin and weight for every outcome. Keep the answer compact and state the invariant that proves it works.',
  })
  const finishReason = await puzzle.finishReason
  const usage = await puzzle.usage
  const text = await puzzle.text
  const reasoningRow = {
    rowType: 'experiment',
    task: 'reasoning_counts',
    runIndex: 1,
    modelId: MODEL_ID,
    finishReason,
    outputTokens: usage.outputTokens ?? null,
    reasoningTokens:
      usage.outputTokenDetails.reasoningTokens ?? usage.reasoningTokens ?? null,
    textLength: text.length,
    aiSdkLimitSetting: 'maxOutputTokens',
    aiSdkLimitValue: 300,
    workersAiRequestLimitParameter: 'max_tokens',
  }
  await appendRows([reasoningRow])
  console.table([reasoningRow])
  console.table(tasks.map(([task]) => makeSummary(task, allSteps[task])))
}

const runResult = await Result.tryPromise({
  try: run,
  catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
})
if (runResult.isErr()) {
  console.error(runResult.error.message)
  process.exitCode = 1
}
