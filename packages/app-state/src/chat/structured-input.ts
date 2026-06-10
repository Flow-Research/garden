// ─────────────────────────────────────────────────────────────────────────────
// Structured input types for agent-driven clarification and message drafting.
//
// Modeled after the t3code UserInputQuestion pattern (see
// refs/t3code/packages/contracts/src/providerRuntime.ts) and the Claude.ai
// ask_user_input / message_compose tools.
//
// These types are shared between the agent runtime (which produces them as
// tool calls) and the web UI (which renders interactive widgets).
// ─────────────────────────────────────────────────────────────────────────────

// ── Structured question (agent asks user to pick from options) ───────────────

export type StructuredQuestionOption = {
  label: string
  description?: string
}

export type StructuredQuestion = {
  id: string
  header?: string
  question: string
  options: StructuredQuestionOption[]
  multiSelect?: boolean
}

export type StructuredQuestionRequest = {
  kind: 'structured_question'
  questions: StructuredQuestion[]
}

export type StructuredQuestionAnswers = Record<string, string | string[]>

// ── Draft answer state (tracks user selections before submission) ────────────

export type StructuredQuestionDraft = {
  selectedLabels?: string[]
  customAnswer?: string
}

export function resolveQuestionAnswer(
  question: StructuredQuestion,
  draft: StructuredQuestionDraft | undefined,
): string | string[] | null {
  const custom = draft?.customAnswer?.trim()
  if (custom && custom.length > 0) return custom

  const selected = (draft?.selectedLabels ?? []).filter(Boolean)
  if (question.multiSelect) {
    return selected.length > 0 ? selected : null
  }

  return selected[0] ?? null
}

export function toggleOptionSelection(
  question: StructuredQuestion,
  draft: StructuredQuestionDraft | undefined,
  optionLabel: string,
): StructuredQuestionDraft {
  if (question.multiSelect) {
    const current = (draft?.selectedLabels ?? []).filter(Boolean)
    const next = current.includes(optionLabel)
      ? current.filter((label) => label !== optionLabel)
      : [...current, optionLabel]
    return { customAnswer: '', selectedLabels: next }
  }

  return { customAnswer: '', selectedLabels: [optionLabel] }
}

export function buildAnswers(
  questions: readonly StructuredQuestion[],
  drafts: Record<string, StructuredQuestionDraft>,
): StructuredQuestionAnswers | null {
  const answers: StructuredQuestionAnswers = {}
  for (const question of questions) {
    const answer = resolveQuestionAnswer(question, drafts[question.id])
    if (!answer) return null
    answers[question.id] = answer
  }
  return answers
}

export function countAnswered(
  questions: readonly StructuredQuestion[],
  drafts: Record<string, StructuredQuestionDraft>,
): number {
  return questions.reduce((count, q) => {
    return resolveQuestionAnswer(q, drafts[q.id]) ? count + 1 : count
  }, 0)
}

export function findFirstUnanswered(
  questions: readonly StructuredQuestion[],
  drafts: Record<string, StructuredQuestionDraft>,
): number {
  const index = questions.findIndex(
    (q) => !resolveQuestionAnswer(q, drafts[q.id]),
  )
  return index === -1 ? Math.max(questions.length - 1, 0) : index
}

// ── Message compose (agent drafts messages with strategic variants) ──────────

export type MessageVariant = {
  label: string
  body: string
  subject?: string
}

export type MessageComposeRequest = {
  kind: 'message_compose'
  messageKind: 'email' | 'text' | 'other'
  summaryTitle: string
  variants: MessageVariant[]
}
