import {
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { marked, type Token, type Tokens } from 'marked'

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const

const ORDERED_REFERENCE = 'garden-ordered'

const CELL_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
  left: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
  right: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
}

type Block = Paragraph | Table
type RunStyle = { bold?: boolean; italics?: boolean; code?: boolean }

/** Flattens marked inline tokens into Word runs, keeping bold/italic/code. */
function inlineRuns(tokens: Token[] | undefined, style: RunStyle = {}) {
  const runs: TextRun[] = []
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'strong':
        runs.push(...inlineRuns(token.tokens, { ...style, bold: true }))
        break
      case 'em':
        runs.push(...inlineRuns(token.tokens, { ...style, italics: true }))
        break
      case 'codespan':
        runs.push(
          new TextRun({ text: token.text, ...style, font: 'Courier New' }),
        )
        break
      case 'link':
        runs.push(...inlineRuns(token.tokens, style))
        break
      case 'br':
        runs.push(new TextRun({ text: '', break: 1 }))
        break
      default: {
        const nested = (token as { tokens?: Token[] }).tokens
        if (nested?.length) runs.push(...inlineRuns(nested, style))
        else
          runs.push(
            new TextRun({
              text: (token as { text?: string }).text ?? token.raw,
              bold: style.bold,
              italics: style.italics,
            }),
          )
      }
    }
  }
  return runs
}

/** Converts one list (and nested lists) into Word bullet/numbered paragraphs. */
function listParagraphs(list: Tokens.List, level: number): Paragraph[] {
  const out: Paragraph[] = []
  for (const item of list.items) {
    const inline = item.tokens.filter((token) => token.type !== 'list')
    const runs = inline.flatMap((token) =>
      'tokens' in token && token.tokens
        ? inlineRuns(token.tokens)
        : inlineRuns([token]),
    )
    out.push(
      new Paragraph({
        children: runs,
        ...(list.ordered
          ? { numbering: { reference: ORDERED_REFERENCE, level } }
          : { bullet: { level } }),
      }),
    )
    for (const nested of item.tokens) {
      if (nested.type === 'list')
        out.push(...listParagraphs(nested as Tokens.List, level + 1))
    }
  }
  return out
}

/** Converts a GFM table into a Word table with a bold repeating header row. */
function tableBlock(table: Tokens.Table): Table {
  const cell = (tokens: Token[], header: boolean) =>
    new TableCell({
      borders: CELL_BORDER,
      ...(header ? { shading: { fill: 'F2F2F2' } } : {}),
      children: [
        new Paragraph({ children: inlineRuns(tokens, { bold: header }) }),
      ],
    })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: table.header.map((head) => cell(head.tokens, true)),
      }),
      ...table.rows.map(
        (row) =>
          new TableRow({
            children: row.map((value) => cell(value.tokens, false)),
          }),
      ),
    ],
  })
}

/** Maps top-level Markdown blocks to Word blocks. */
function blocksOf(tokens: Token[]): Block[] {
  const blocks: Block[] = []
  for (const token of tokens) {
    switch (token.type) {
      case 'heading':
        blocks.push(
          new Paragraph({
            heading: HEADINGS[Math.min(token.depth, 6) - 1],
            children: inlineRuns(token.tokens),
          }),
        )
        break
      case 'paragraph':
        blocks.push(new Paragraph({ children: inlineRuns(token.tokens) }))
        break
      case 'list':
        blocks.push(...listParagraphs(token as Tokens.List, 0))
        break
      case 'table':
        blocks.push(tableBlock(token as Tokens.Table), new Paragraph({}))
        break
      case 'code':
        for (const line of token.text.split('\n')) {
          blocks.push(
            new Paragraph({
              children: [new TextRun({ text: line, font: 'Courier New' })],
            }),
          )
        }
        break
      case 'blockquote':
        blocks.push(...blocksOf(token.tokens ?? []))
        break
      case 'hr':
      case 'space':
        break
      default:
        if (token.raw.trim())
          blocks.push(
            new Paragraph({ children: [new TextRun({ text: token.raw })] }),
          )
    }
  }
  return blocks
}

/**
 * Renders a Markdown document as .docx bytes for "Download as Word" (#381).
 * Files & Folders stores the Markdown as the source of truth; Word is
 * generated on demand at download time and never stored. `generate_docx`
 * builds Word from structured sections an agent writes, so it cannot take
 * Markdown; this path parses with `marked` (GFM tables) and writes Word
 * headings, bullet/numbered lists, and tables with `docx`, both existing
 * dependencies of this package and both pure JS that run on Workers.
 */
export async function markdownToDocx(args: {
  title: string
  markdown: string
}): Promise<Uint8Array<ArrayBuffer>> {
  const document = new Document({
    title: args.title,
    numbering: {
      config: [
        {
          reference: ORDERED_REFERENCE,
          levels: Array.from({ length: 6 }, (_, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            style: {
              paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } },
            },
          })),
        },
      ],
    },
    sections: [{ children: blocksOf(marked.lexer(args.markdown)) }],
  })
  return new Uint8Array(await Packer.toArrayBuffer(document))
}
