import { DOC_BUILTIN_SKILL_FILES } from './bundled-skill-files'

const BUILTIN_SKILLS_PREFIX = 'builtin-skills'

export type BuiltinSkillFile = Readonly<{
  path: string
  content?: string | null
  contentHash?: string | null
  r2Key?: string | null
}>

export type BuiltinSkillManifest = Readonly<{
  slug: string
  name: string
  description: string
  sourceUrl: string | null
  body?: string | null
  bodyR2Key?: string | null
  files?: readonly BuiltinSkillFile[]
}>

export function buildBuiltinSkillObjectKey(input: {
  slug: string
  path: string
}) {
  return [BUILTIN_SKILLS_PREFIX, input.slug, input.path].join('/')
}

export const DOC_BUILTIN_SKILLS: readonly BuiltinSkillManifest[] = [
  {
    slug: 'xlsx',
    name: 'xlsx',
    description:
      'Excel Spreadsheet Handler: Comprehensive Microsoft Excel (.xlsx) document creation, editing, and analysis with support for formulas, formatting, data analysis, and visualization. MANDATORY TRIGGERS: Excel, spreadsheet, .xlsx, data table, budget, financial model, chart, graph, tabular data, xls',
    sourceUrl: null,
    bodyR2Key: buildBuiltinSkillObjectKey({ slug: 'xlsx', path: 'SKILL.md' }),
    files: DOC_BUILTIN_SKILL_FILES.xlsx.map((path) => ({ path })),
  },
  {
    slug: 'pptx',
    name: 'pptx',
    description:
      'Use this skill any time a .pptx file is involved in any way — as input, output, or both. This includes: creating slide decks, pitch decks, or presentations; reading, parsing, or extracting text from any .pptx file (even if the extracted content will be used elsewhere, like in an email or summary); editing, modifying, or updating existing presentations; combining or splitting slide files; working with templates, layouts, speaker notes, or comments. Trigger whenever the user mentions "deck," "slides," "presentation," or references a .pptx filename, regardless of what they plan to do with the content afterward. If a .pptx file needs to be opened, created, or touched, use this skill.',
    sourceUrl: null,
    bodyR2Key: buildBuiltinSkillObjectKey({ slug: 'pptx', path: 'SKILL.md' }),
    files: DOC_BUILTIN_SKILL_FILES.pptx.map((path) => ({ path })),
  },
  {
    slug: 'pdf',
    name: 'pdf',
    description:
      'PDF Processing: Comprehensive PDF manipulation toolkit for extracting text and tables, creating new PDFs, merging/splitting documents, and handling forms. MANDATORY TRIGGERS: PDF, .pdf, form, extract, merge, split',
    sourceUrl: null,
    bodyR2Key: buildBuiltinSkillObjectKey({ slug: 'pdf', path: 'SKILL.md' }),
    files: DOC_BUILTIN_SKILL_FILES.pdf.map((path) => ({ path })),
  },
  {
    slug: 'docx',
    name: 'docx',
    description:
      "Use this skill whenever the user wants to create, read, edit, or manipulate Word documents (.docx files). Triggers include: any mention of 'Word doc', 'word document', '.docx', or requests to produce professional documents with formatting like tables of contents, headings, page numbers, or letterheads. Also use when extracting or reorganizing content from .docx files, inserting or replacing images in documents, performing find-and-replace in Word files, working with tracked changes or comments, or converting content into a polished Word document. If the user asks for a 'report', 'memo', 'letter', 'template', or similar deliverable as a Word or .docx file, use this skill. Do NOT use for PDFs, spreadsheets, Google Docs, or general coding tasks unrelated to document generation.",
    sourceUrl: null,
    bodyR2Key: buildBuiltinSkillObjectKey({ slug: 'docx', path: 'SKILL.md' }),
    files: DOC_BUILTIN_SKILL_FILES.docx.map((path) => ({ path })),
  },
] as const

export const DOC_BUILTIN_SKILL_REMINDER = [
  '- Creating presentations -> Read `/.agents/skills/pptx/SKILL.md`',
  '- Creating spreadsheets -> Read `/.agents/skills/xlsx/SKILL.md`',
  '- Creating word documents -> Read `/.agents/skills/docx/SKILL.md`',
  "- Creating PDFs -> Read `/.agents/skills/pdf/SKILL.md` (Don't use pypdf.)",
].join('\n')
