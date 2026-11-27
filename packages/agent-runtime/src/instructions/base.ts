import { DOC_BUILTIN_SKILL_REMINDER } from '../bundled-skills'
import foundationMarkdown from './foundation.md?raw'

const FOUNDATION_SECTION_ORDER = [
  'role',
  'scope',
  'voice',
  'examples',
  'workflow',
  'issues',
  'wellbeing',
  'memory',
  'sandbox',
  'documents',
  'skills',
  'functionCalls',
  'references',
  'security',
  'privacy',
  'approvals',
  'refusal',
] as const

type FoundationSectionId = (typeof FOUNDATION_SECTION_ORDER)[number]

export type PromptSection<TId extends string> = Readonly<{
  id: TId
  title: string
  body: string
}>

/** The `## ` heading each section has in foundation.md, in prompt order. */
const FOUNDATION_SECTION_TITLES = {
  role: 'Role',
  scope: 'Scope',
  voice: 'Voice',
  examples: 'What this sounds like',
  workflow: 'Workflow',
  issues: 'Issue coordination',
  wellbeing: 'Wellbeing',
  memory: 'Memory',
  sandbox: 'Sandbox',
  documents: 'Documents',
  skills: 'Skills',
  functionCalls: 'Tools and function calls',
  references: 'References',
  security: 'Security',
  privacy: 'Privacy',
  approvals: 'Approvals',
  refusal: 'Refusal',
} satisfies Record<FoundationSectionId, string>

const SKILL_REMINDER_PLACEHOLDER = '{{DOC_BUILTIN_SKILL_REMINDER}}'

/**
 * Splits foundation.md into its sections. The prompt text used to live inline
 * here as 16 KB of template literals; keeping it in a Markdown asset makes it
 * reviewable as prose. Headings must match FOUNDATION_SECTION_TITLES exactly
 * and in order, so a renamed or reordered heading fails at module load (and
 * in the prompt tests) instead of silently dropping a section.
 */
function parseFoundationSections(markdown: string) {
  // Checkouts with CRLF line endings must not change the prompt text.
  const normalized = markdown.replace(/\r\n/g, '\n')
  const chunks = normalized.split(/^## /m).slice(1)
  if (chunks.length !== FOUNDATION_SECTION_ORDER.length) {
    throw new Error(
      `foundation.md has ${chunks.length} sections; expected ${FOUNDATION_SECTION_ORDER.length}.`,
    )
  }

  const entries = FOUNDATION_SECTION_ORDER.map((id, index) => {
    const chunk = chunks[index] ?? ''
    const newline = chunk.indexOf('\n')
    const title = newline < 0 ? chunk.trim() : chunk.slice(0, newline).trim()
    if (title !== FOUNDATION_SECTION_TITLES[id]) {
      throw new Error(
        `foundation.md section ${index + 1} is "${title}"; expected "${FOUNDATION_SECTION_TITLES[id]}".`,
      )
    }
    const body = (newline < 0 ? '' : chunk.slice(newline + 1))
      .replaceAll(SKILL_REMINDER_PLACEHOLDER, DOC_BUILTIN_SKILL_REMINDER)
      .trim()
    return [id, { id, title, body }] as const
  })

  return Object.fromEntries(entries) as {
    [TId in FoundationSectionId]: PromptSection<TId>
  }
}

const FOUNDATION_SECTIONS = parseFoundationSections(foundationMarkdown)

export { FOUNDATION_SECTION_ORDER, FOUNDATION_SECTIONS }
