import LinkifyIt from 'linkify-it'

const parser = new LinkifyIt()
const FILE_PATH =
  /(?:^|[\s([{<])((?:\/|~\/|\.\/)[\w./@-]+\.(?:ts|tsx|js|jsx|md|json|ya?ml|py|go|rs|css|html?|txt|log|sh|swift|kt|java|c|cpp|h|rb|php|xml|toml|ini|env|sql|graphql|vue|svelte|astro|prisma))(?=[\s)\]}.,;:!?>]|$)/gi

interface DetectedLink {
  type: 'url' | 'email' | 'file'
  text: string
  url: string
  start: number
  end: number
}

interface TextRange {
  start: number
  end: number
}

function rangesOverlap(left: TextRange, right: TextRange): boolean {
  return left.start < right.end && right.start < left.end
}

/** Finds fenced and inline code spans where linkification must never run. */
function protectedCodeRanges(text: string): TextRange[] {
  const ranges: TextRange[] = []
  const patterns = [
    /```[\s\S]*?```/g,
    /`[^`\n]+`/g,
    /\$\$[\s\S]*?\$\$/g,
    /(?<!\$)\$[^$\n]+\$(?!\$)/g,
  ]

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0
      const candidate = { start, end: start + match[0].length }
      if (!ranges.some((range) => rangesOverlap(range, candidate)))
        ranges.push(candidate)
    }
  }
  return ranges
}

function alreadyMarkdownLinked(text: string, link: TextRange): boolean {
  const prefix = text.slice(Math.max(0, link.start - 2), link.start)
  return (
    prefix === '](' ||
    prefix === '][' ||
    (text[link.start - 1] === '[' && text[link.end] === ']')
  )
}

/** Detects URL, email, and local-file candidates in their source order. */
export function detectLinks(text: string): DetectedLink[] {
  const links: DetectedLink[] = (parser.match(text) ?? []).map((match) => ({
    type: match.schema === 'mailto:' ? 'email' : 'url',
    text: match.text,
    url: match.url,
    start: match.index,
    end: match.lastIndex,
  }))

  FILE_PATH.lastIndex = 0
  for (const match of text.matchAll(FILE_PATH)) {
    const path = match[1]
    if (!path) continue
    const start = (match.index ?? 0) + match[0].indexOf(path)
    const candidate = { start, end: start + path.length }
    if (links.some((link) => rangesOverlap(link, candidate))) continue
    links.push({ type: 'file', text: path, url: path, ...candidate })
  }

  return links.sort((left, right) => left.start - right.start)
}

/** Wraps raw link candidates in Markdown while preserving code and existing links. */
export function preprocessLinks(text: string): string {
  if (!hasLinks(text)) return text
  const protectedRanges = protectedCodeRanges(text)
  const replacements = detectLinks(text).filter(
    (link) =>
      !protectedRanges.some((range) => rangesOverlap(range, link)) &&
      !alreadyMarkdownLinked(text, link),
  )

  return [...replacements]
    .reverse()
    .reduce(
      (result, link) =>
        `${result.slice(0, link.start)}[${link.text}](${link.url})${result.slice(link.end)}`,
      text,
    )
}

export function hasLinks(text: string): boolean {
  return parser.pretest(text) || /(?:^|\s)(?:\/|~\/|\.\/)\S+/m.test(text)
}
