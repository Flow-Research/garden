import { Result } from 'better-result'
import { z } from 'zod'

/**
 * Reads what Garden needs from a stored Decide `analyze` result. Decide
 * returns plain MCP `content` text blocks and no `structuredContent`
 * (checked against staging `decide_analysis_run.result_json`), so the
 * session ID and generated files are parsed from the text here, at one
 * boundary, instead of each caller guessing at the shape.
 */

export type DecideGeneratedFile = { name: string; url: string }

const textBlockSchema = z.object({ type: z.literal('text'), text: z.string() })
const resourceLinkSchema = z.object({
  type: z.literal('resource_link'),
  name: z.string(),
  uri: z.string(),
})
const structuredFileSchema = z.object({
  name: z.string().optional(),
  filename: z.string().optional(),
  url: z.string().optional(),
  uri: z.string().optional(),
  download_url: z.string().optional(),
})
const resultSchema = z.object({
  content: z.array(z.unknown()).catch([]),
  structuredContent: z
    .object({
      session_id: z.string().optional().catch(undefined),
      files: z.array(z.unknown()).optional().catch(undefined),
      generated_files: z.array(z.unknown()).optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
})

const parseResult = (resultJson: unknown) => {
  const parsed = resultSchema.safeParse(resultJson)
  return parsed.success
    ? parsed.data
    : { content: [], structuredContent: undefined }
}

/** The non-empty text blocks of a Decide result, trimmed, in order. */
export function decideResultTexts(resultJson: unknown): string[] {
  return parseResult(resultJson).content.flatMap((block) => {
    const text = textBlockSchema.safeParse(block)
    return text.success && text.data.text.trim() ? [text.data.text.trim()] : []
  })
}

const SESSION_ID_PATTERN = /\bsess_[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*/

/**
 * The Decide session a follow-up can continue. Before, Garden read only
 * `structuredContent.session_id`, which Decide never sends, so every run
 * stored `provider_session_id = null`. Decide prints the ID in its text
 * ("Session ID: sess_…", "(session_id: sess_…)") and in output URLs
 * (`/agent-sessions/sess_…/outputs/…`); all three carry the same token.
 */
export function decideSessionIdFromResult(resultJson: unknown): string | null {
  const { structuredContent } = parseResult(resultJson)
  if (structuredContent?.session_id) return structuredContent.session_id
  for (const text of decideResultTexts(resultJson)) {
    const match = SESSION_ID_PATTERN.exec(text)
    if (match) return match[0]
  }
  return null
}

const URL_PATTERN = /https?:\/\/[^\s<>"'()[\]{}`]+/g
const FILE_EXTENSION_PATTERN = /\.[A-Za-z0-9]{2,5}$/
const TRAILING_PUNCTUATION = /[.,;:!?*_]+$/

const fileFromUrl = (raw: string): DecideGeneratedFile | null => {
  const url = raw.replace(TRAILING_PUNCTUATION, '')
  if (!URL.canParse(url)) return null
  const segment = new URL(url).pathname.split('/').filter(Boolean).at(-1)
  if (!segment || !FILE_EXTENSION_PATTERN.test(segment)) return null
  const name = Result.try(() => decodeURIComponent(segment)).unwrapOr(segment)
  return { name, url }
}

/**
 * Files Decide generated for this run, deduplicated by URL. Decide links
 * outputs inline in its text, so any URL whose last path segment has a file
 * extension counts, alongside MCP `resource_link` blocks and structured
 * file lists should Decide start sending them.
 */
export function decideGeneratedFiles(
  resultJson: unknown,
): DecideGeneratedFile[] {
  const { content, structuredContent } = parseResult(resultJson)
  const fromLinks = content.flatMap((block) => {
    const link = resourceLinkSchema.safeParse(block)
    return link.success ? [{ name: link.data.name, url: link.data.uri }] : []
  })
  const fromStructured = [
    ...(structuredContent?.files ?? []),
    ...(structuredContent?.generated_files ?? []),
  ].flatMap((entry) => {
    const file = structuredFileSchema.safeParse(entry)
    if (!file.success) return []
    const name = file.data.name ?? file.data.filename
    const url = file.data.url ?? file.data.download_url ?? file.data.uri
    return name && url ? [{ name, url }] : []
  })
  const fromText = decideResultTexts(resultJson).flatMap((text) =>
    [...text.matchAll(URL_PATTERN)].flatMap((match) => {
      const file = fileFromUrl(match[0])
      return file ? [file] : []
    }),
  )
  const seen = new Set<string>()
  return [...fromLinks, ...fromStructured, ...fromText].filter((file) => {
    if (seen.has(file.url)) return false
    seen.add(file.url)
    return true
  })
}
