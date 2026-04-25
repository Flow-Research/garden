const BUILTIN_SKILLS_PREFIX = 'builtin-skills'
const BUILTIN_SKILL_MANIFEST_FILENAME = 'manifest.json'

export type BuiltinSkillManifest = Readonly<{
  slug: string
  name: string
  description: string
  sourceUrl: string
  bundleHash: string
}>

export function buildBuiltinSkillObjectKey(input: {
  slug: string
  bundleHash: string
  path: string
}) {
  return [
    BUILTIN_SKILLS_PREFIX,
    input.slug,
    input.bundleHash,
    input.path,
  ].join('/')
}

export function buildBuiltinSkillManifestObjectKey(input: {
  slug: string
  bundleHash: string
}) {
  return buildBuiltinSkillObjectKey({
    slug: input.slug,
    bundleHash: input.bundleHash,
    path: BUILTIN_SKILL_MANIFEST_FILENAME,
  })
}

export type BuiltinBundleFileManifest = Readonly<{
  files: readonly string[]
}>

export const DOC_BUILTIN_SKILLS: readonly BuiltinSkillManifest[] = [
  {
    slug: 'xlsx',
    name: 'xlsx',
    description:
      'Excel Spreadsheet Handler: Comprehensive Microsoft Excel (.xlsx) document creation, editing, and analysis with support for formulas, formatting, data analysis, and visualization. MANDATORY TRIGGERS: Excel, spreadsheet, .xlsx, data table, budget, financial model, chart, graph, tabular data, xls',
    sourceUrl: 'https://skills.sh/anthropics/skills/xlsx',
    bundleHash:
      '0e18c57930faa863bfeed4516fc730bd567089499437c4beb83550d4cb5a03a0',
  },
  {
    slug: 'pptx',
    name: 'pptx',
    description:
      'Use this skill any time a .pptx file is involved in any way — as input, output, or both. This includes: creating slide decks, pitch decks, or presentations; reading, parsing, or extracting text from any .pptx file (even if the extracted content will be used elsewhere, like in an email or summary); editing, modifying, or updating existing presentations; combining or splitting slide files; working with templates, layouts, speaker notes, or comments. Trigger whenever the user mentions "deck," "slides," "presentation," or references a .pptx filename, regardless of what they plan to do with the content afterward. If a .pptx file needs to be opened, created, or touched, use this skill.',
    sourceUrl: 'https://skills.sh/anthropics/skills/pptx',
    bundleHash:
      'b903b70c73ef7182f00810ad498a97fac0411976673681c616e373ac390ec04d',
  },
  {
    slug: 'pdf',
    name: 'pdf',
    description:
      'PDF Processing: Comprehensive PDF manipulation toolkit for extracting text and tables, creating new PDFs, merging/splitting documents, and handling forms. MANDATORY TRIGGERS: PDF, .pdf, form, extract, merge, split',
    sourceUrl: 'https://skills.sh/anthropics/skills/pdf',
    bundleHash:
      '7c96a2fd5ed6490df5282564198dba6a93ca5f576457908214cb2599e47a3da5',
  },
  {
    slug: 'docx',
    name: 'docx',
    description:
      "Use this skill whenever the user wants to create, read, edit, or manipulate Word documents (.docx files). Triggers include: any mention of 'Word doc', 'word document', '.docx', or requests to produce professional documents with formatting like tables of contents, headings, page numbers, or letterheads. Also use when extracting or reorganizing content from .docx files, inserting or replacing images in documents, performing find-and-replace in Word files, working with tracked changes or comments, or converting content into a polished Word document. If the user asks for a 'report', 'memo', 'letter', 'template', or similar deliverable as a Word or .docx file, use this skill. Do NOT use for PDFs, spreadsheets, Google Docs, or general coding tasks unrelated to document generation.",
    sourceUrl: 'https://skills.sh/anthropics/skills/docx',
    bundleHash:
      '28028d93265d45723aa7b182c8951b94662ab60148d96817d5cbb723efe4b388',
  },
] as const

export const DOC_BUILTIN_SKILL_REMINDER = [
  '- Creating presentations -> Read `/.agents/skills/pptx/SKILL.md`',
  '- Creating spreadsheets -> Read `/.agents/skills/xlsx/SKILL.md`',
  '- Creating word documents -> Read `/.agents/skills/docx/SKILL.md`',
  "- Creating PDFs -> Read `/.agents/skills/pdf/SKILL.md` (Don't use pypdf.)",
].join('\n')
