import { Result } from 'better-result'
import { z } from 'zod'
import type { ChatTaskEvidence, TaskDefinition } from '../index.ts'
import { GardenEvalError } from '../runner/errors.ts'
import type { DecideWorkbookInspection } from './decide-workbook.ts'

const decideRunExpectedSchema = z
  .object({ status: z.literal('completed'), runCount: z.literal(1) })
  .strict()
const decideRunAbsentExpectedSchema = z
  .object({ runCount: z.literal(0) })
  .strict()
const workbookSheetsExpectedSchema = z
  .object({ sheets: z.array(z.string().min(1)).min(1) })
  .strict()
const rawDataExpectedSchema = z
  .object({ rows: z.number().int().positive() })
  .strict()
const verificationExpectedSchema = z
  .object({
    date: z.string().min(1),
    regions: z.array(z.string().min(1)).min(1),
  })
  .strict()
const correctionExpectedSchema = z
  .object({ original: z.string().min(1), proposed: z.string().min(1) })
  .strict()
const answerExpectedSchema = z
  .object({ values: z.array(z.string().min(1)).min(1) })
  .strict()
const calendarDateSchema = z.iso.date()
const englishDateFormatters = ['en-US', 'en-GB'].flatMap((locale) => [
  new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }),
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }),
])

export type DecideAnalysisObservation = NonNullable<
  ChatTaskEvidence['decideAnalysis']
>

export type ChatTaskCheck = {
  criterionId: string
  passed: boolean
  evidenceReferences: string[]
}

/**
 * Grades a chat task from its response and run-scoped public evidence. Before
 * this function, the Promptfoo provider had no task-specific Garden graders.
 * References: the task registry and Garden's thread-scoped Decide status API.
 */
export function gradeChatTask(input: {
  task: TaskDefinition & { surface: 'chat' }
  threadId: string
  response: string
  decideAnalysis: DecideAnalysisObservation | null
}): Result<ChatTaskCheck[], GardenEvalError> {
  return Result.gen(function* () {
    const checks: ChatTaskCheck[] = []
    for (const criterion of input.task.successCriteria) {
      const checked = gradeCriterion({
        graderId: criterion.graderId,
        expected: criterion.expected,
        response: input.response,
        decideAnalysis: input.decideAnalysis,
        threadId: input.threadId,
      })
      const check = yield* checked
      checks.push({
        criterionId: criterion.criterionId,
        passed: check,
        evidenceReferences: criterion.requiredEvidence.map((source) =>
          evidenceReference(source, input.threadId, input.decideAnalysis),
        ),
      })
    }
    return Result.ok(checks)
  })
}

/** Validates one task grader's expected values before using them. */
function gradeCriterion(input: {
  graderId: string
  expected: unknown
  response: string
  decideAnalysis: DecideAnalysisObservation | null
  threadId: string
}): Result<boolean, GardenEvalError> {
  switch (input.graderId) {
    case 'decide-run-absent': {
      const expected = decideRunAbsentExpectedSchema.safeParse(input.expected)
      if (!expected.success) return invalidExpected(input.graderId)
      return Result.ok(
        input.decideAnalysis?.observedRunCount === expected.data.runCount,
      )
    }
    case 'decide-run-completed-once': {
      const expected = decideRunExpectedSchema.safeParse(input.expected)
      if (!expected.success) return invalidExpected(input.graderId)
      return Result.ok(
        input.decideAnalysis?.observedRunCount === expected.data.runCount &&
          input.decideAnalysis.status === expected.data.status,
      )
    }
    case 'decide-workbook-sheets': {
      const expected = workbookSheetsExpectedSchema.safeParse(input.expected)
      if (!expected.success) return invalidExpected(input.graderId)
      const workbook = input.decideAnalysis?.workbook
      return Result.ok(
        workbook?.opened === true &&
          expected.data.sheets.every((name) =>
            workbook.sheetNames.includes(name),
          ),
      )
    }
    case 'decide-workbook-raw-data': {
      const expected = rawDataExpectedSchema.safeParse(input.expected)
      if (!expected.success) return invalidExpected(input.graderId)
      return Result.ok(
        input.decideAnalysis?.workbook?.rawDataPreserved === true,
      )
    }
    case 'decide-workbook-verification': {
      const expected = verificationExpectedSchema.safeParse(input.expected)
      if (!expected.success) return invalidExpected(input.graderId)
      return Result.ok(
        input.decideAnalysis?.workbook?.verificationMatches === true,
      )
    }
    case 'decide-workbook-analysis': {
      const expected = correctionExpectedSchema.safeParse(input.expected)
      if (!expected.success) return invalidExpected(input.graderId)
      return Result.ok(
        input.decideAnalysis?.workbook?.analysisKeepsCorrectionSeparate ===
          true,
      )
    }
    case 'chat-answer-includes-fixture-facts': {
      const expected = answerExpectedSchema.safeParse(input.expected)
      if (!expected.success) return invalidExpected(input.graderId)
      return Result.ok(
        expected.data.values.every((value) =>
          includesExpectedFact(input.response, value),
        ),
      )
    }
    default:
      return Result.err(
        new GardenEvalError({
          stage: 'grading',
          code: 'unsupported_grader',
          message: `Garden chat eval does not support grader ${input.graderId}.`,
          invalidReason: 'unsupported_environment',
          threadId: input.threadId,
        }),
      )
  }
}

/**
 * Accepts calendar-date equivalents without loosening other fixture facts.
 * The brief's correct "December 14, 2026" answer previously failed literal
 * ISO matching. UTC formatting avoids timezone shifts and ambiguous parsing.
 * References: `uploadedBriefTask`, Zod ISO dates, and `Intl.DateTimeFormat`.
 */
function includesExpectedFact(response: string, expected: string): boolean {
  const calendarDate = calendarDateSchema.safeParse(expected)
  if (!calendarDate.success) {
    const text = response.toLocaleLowerCase()
    const value = expected.toLocaleLowerCase()
    const index = text.indexOf(value)
    if (index < 0) return false
    const before = text.slice(Math.max(0, index - 24), index)
    const after = text.slice(index + value.length, index + value.length + 32)
    return !(
      /\b(?:not|isn't|is not|never|wrong|incorrect)\b[^.!?]*$/.test(before) ||
      /^\s+(?:is\s+)?(?:not|wrong|incorrect)\b/.test(after) ||
      /\bnot\s+(?:the\s+)?owner\b/.test(after)
    )
  }

  const date = new Date(`${calendarDate.data}T00:00:00Z`)
  const equivalents = [
    calendarDate.data,
    ...englishDateFormatters.map((formatter) => formatter.format(date)),
  ]
  const normalizedResponse = ` ${normalizeDateText(response)} `
  const expectedDates = new Set(equivalents.map(normalizeDateText))
  const month =
    '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
  const writtenDate = new RegExp(
    `\\b(?:\\d{4}-\\d{2}-\\d{2}|${month}\\s+\\d{1,2}\\s+\\d{4}|\\d{1,2}\\s+${month}\\s+\\d{4})\\b`,
    'gi',
  )
  if (
    [...normalizedResponse.matchAll(writtenDate)].some(
      (match) => !expectedDates.has(match[0].trim()),
    )
  )
    return false
  return equivalents.some((equivalent) => {
    const token = ` ${normalizeDateText(equivalent)} `
    const index = normalizedResponse.indexOf(token)
    if (index < 0) return false
    const before = normalizedResponse.slice(Math.max(0, index - 35), index)
    return (
      /\blaunch(?:es|ed)?\b/.test(before) &&
      !/\b(?:not|wrong|incorrect)\b(?:\s+\w+){0,5}\s*$/.test(before)
    )
  })
}

/**
 * Ignores punctuation, whitespace, and English ordinal suffixes when matching
 * formatted dates. Whole tokens prevent the old substring match from accepting
 * extra day/year digits. ISO hyphens stay distinct from numeric date formats.
 */
function normalizeDateText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/g, '$1')
    .replace(/[^\p{L}\p{N}-]+/gu, ' ')
    .trim()
}

/** Builds a report reference without including document text or file URLs. */
function evidenceReference(
  source: TaskDefinition['successCriteria'][number]['requiredEvidence'][number],
  threadId: string,
  decideAnalysis: DecideAnalysisObservation | null,
): string {
  if (source === 'decide_analysis' || source === 'decide_workbook') {
    return `decide-${source === 'decide_analysis' ? 'analysis' : 'workbook'}:${decideAnalysis?.runId ?? threadId}`
  }
  return `${source}:${threadId}`
}

/** Returns a typed invalid result when a task stores malformed grader data. */
function invalidExpected(graderId: string): Result<never, GardenEvalError> {
  return Result.err(
    new GardenEvalError({
      stage: 'grading',
      code: 'invalid_criterion',
      message: `The Garden chat task has invalid expected values for ${graderId}.`,
      invalidReason: 'grader_execution_failed',
    }),
  )
}

/** Creates safe workbook evidence from the in-memory workbook inspection. */
export function decideWorkbookEvidence(input: {
  runId: string
  observedRunCount: number
  status: DecideAnalysisObservation['status']
  fileNames: string[]
  inspection: DecideWorkbookInspection | null
}): DecideAnalysisObservation {
  return {
    observedRunCount: input.observedRunCount,
    runId: input.observedRunCount === 1 ? input.runId : null,
    status: input.observedRunCount === 1 ? input.status : null,
    fileNames: input.fileNames,
    workbook: input.inspection
      ? {
          name:
            input.fileNames.find((name) =>
              name.toLowerCase().endsWith('.xlsx'),
            ) ?? 'unknown.xlsx',
          digest: input.inspection.digest,
          sheetNames: input.inspection.sheetNames,
          opened: input.inspection.opened,
          rawDataPreserved: input.inspection.rawDataPreserved,
          verificationMatches: input.inspection.verificationMatches,
          analysisKeepsCorrectionSeparate:
            input.inspection.analysisKeepsCorrectionSeparate,
        }
      : null,
  }
}
