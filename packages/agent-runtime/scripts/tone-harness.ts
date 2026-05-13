import { generateText, tool, stepCountIs } from 'ai'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { createAgentModel } from '../src/model'
import { assembleFoundationPrompt } from '../src/prompt'
import { DOC_BUILTIN_SKILLS } from '../src/bundled-skills'

const devVars = readFileSync(
  new URL('../../../apps/web/.dev.vars', import.meta.url),
  'utf8',
)
function readDevVar(name: string) {
  return devVars
    .split('\n')
    .find((line) => line.startsWith(`${name}=`))
    ?.split('=')[1]
    ?.trim()
    ?.replace(/^["']|["']$/g, '')
}

const accountId = readDevVar('CLOUDFLARE_ACCOUNT_ID')
const apiKey = readDevVar('CF_AIG_TOKEN')

if (!accountId || !apiKey) {
  console.error('CLOUDFLARE_ACCOUNT_ID and CF_AIG_TOKEN must be set in apps/web/.dev.vars')
  process.exit(1)
}

const model = createAgentModel({ accountId, apiKey })

const promptVariant = process.argv[2] ?? 'current'

const skillInventory = DOC_BUILTIN_SKILLS.map(
  (s) => `- ${s.slug}: ${s.description}`,
).join('\n')

const SYSTEM_PROMPT =
  assembleFoundationPrompt() +
  `\n\n## Available skills\n${skillInventory}\n\n## Available document artifact tools\n` +
  [
    '- listDocuments: list workspace docs',
    '- readDocument(documentId): read full text of a doc',
    '- findInDocument(documentId, query): targeted search',
    '- generateDocx(title, sections): create a .docx artifact from a structured outline',
    '- editDocument(documentId, edits): tracked-change substitutions on a .docx artifact',
    '- convertDocumentToPdf(documentId): convert a .docx artifact to a PDF artifact',
    '- load_skill(slug): load a skill body when the artifact tools cannot express the task',
  ].join('\n')

const fakeDocId = '00000000-0000-4000-8000-000000000001'
const tools = {
  listDocuments: tool({
    description: 'List documents in the current chat/workspace.',
    inputSchema: z.object({}),
    execute: async () => ({
      ok: true,
      documents: [
        { id: fakeDocId, filename: 'Q3-board-memo.docx', kind: 'docx' },
      ],
    }),
  }),
  readDocument: tool({
    description: 'Read full text of a document by handle.',
    inputSchema: z.object({ documentId: z.string() }),
    execute: async () => ({
      ok: true,
      text: '# Q3 Board Memo\n\nWe shipped onboarding v2 in August. NPS up to 47.\nBurn is $180k/mo with 18 months runway.',
    }),
  }),
  generateDocx: tool({
    description:
      'Generate a .docx artifact. Section content supports **bold** and *italic* inline markdown.',
    inputSchema: z.object({
      title: z.string(),
      sections: z.array(
        z.object({
          heading: z.string().optional(),
          level: z.number().int().min(1).max(4).optional(),
          content: z.string().optional(),
          pageBreak: z.boolean().optional(),
          table: z
            .object({
              headers: z.array(z.string()),
              rows: z.array(z.array(z.string())),
            })
            .optional(),
        }),
      ),
      landscape: z.boolean().optional(),
      options: z
        .object({
          pageSize: z.enum(['letter', 'a4']).optional(),
          font: z.string().optional(),
          header: z.string().optional(),
          footer: z.string().optional(),
          pageNumbers: z.boolean().optional(),
        })
        .optional(),
    }),
    execute: async ({ title }) => ({
      ok: true,
      documentId: '00000000-0000-4000-8000-000000000099',
      filename: `${title}.docx`,
    }),
  }),
  editDocument: tool({
    description: 'Tracked-change edits on a .docx artifact.',
    inputSchema: z.object({
      documentId: z.string(),
      edits: z.array(
        z.object({
          find: z.string(),
          replace: z.string(),
          context_before: z.string(),
          context_after: z.string(),
          reason: z.string().optional(),
        }),
      ),
    }),
    execute: async () => ({ ok: true, version: 2, editsApplied: 1 }),
  }),
  convertDocumentToPdf: tool({
    description: 'Convert a .docx artifact to PDF.',
    inputSchema: z.object({ documentId: z.string() }),
    execute: async () => ({
      ok: true,
      pdfDocumentId: '00000000-0000-4000-8000-0000000000aa',
    }),
  }),
  load_skill: tool({
    description:
      'Load a skill body by slug when the artifact tools cannot express the task.',
    inputSchema: z.object({ slug: z.string() }),
    execute: async ({ slug }) => {
      const skill = DOC_BUILTIN_SKILLS.find((s) => s.slug === slug)
      if (!skill) return { ok: false, error: `unknown skill: ${slug}` }
      return {
        ok: true,
        slug,
        body: `[${skill.name} SKILL.md body would load here]`,
      }
    },
  }),
}

type EvalItem = {
  id: string
  user: string
  category:
    | 'voice'
    | 'tool-vs-skill'
    | 'oblique-skill'
    | 'doc-existing'
    | 'creative'
}

const evalSet: EvalItem[] = [
  // schema-feature exercises (focus run)
  {
    id: 'schema-header-footer',
    user:
      'draft a Q4 board memo as a docx with "Confidential" in the header and page numbers in the footer',
    category: 'tool-vs-skill',
  },
  {
    id: 'schema-a4',
    user:
      'write a one-pager pricing memo for the UK board, A4 page size, in Calibri',
    category: 'tool-vs-skill',
  },
]

async function run() {
  const promptToUse = SYSTEM_PROMPT
  console.log(`# Variant: ${promptVariant}`)
  console.log(`# Prompt length: ${promptToUse.length} chars`)
  console.log(`# Eval items: ${evalSet.length}\n`)

  for (const item of evalSet) {
    console.log(`\n=== ${item.id} (${item.category}) ===`)
    console.log(`USER: ${item.user}\n`)
    const result = await generateText({
      model,
      system: promptToUse,
      prompt: item.user,
      tools,
      stopWhen: stepCountIs(4),
    })

    const toolCallSummary = (result.steps ?? [])
      .flatMap((step) => step.toolCalls ?? [])
      .map((tc: { toolName?: string; input?: unknown }) => {
        const input = tc.input as Record<string, unknown> | undefined
        const summary: Record<string, unknown> = {}
        if (input) {
          for (const key of Object.keys(input)) {
            const value = input[key]
            if (key === 'sections' && Array.isArray(value)) {
              summary[key] = `[${value.length} sections]`
            } else {
              summary[key] = value
            }
          }
        }
        return `${tc.toolName}(${JSON.stringify(summary)})`
      })
    if (toolCallSummary.length > 0) {
      console.log(`TOOLS: ${toolCallSummary.join(' -> ')}`)
    }
    console.log(`AGENT:\n${result.text}`)
    console.log('\n---')
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
