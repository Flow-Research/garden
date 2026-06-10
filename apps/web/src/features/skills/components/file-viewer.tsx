import { useState, useMemo } from 'react'
import { Pencil, Eye } from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'
import { Textarea } from '@garden/ui/components/ui/textarea'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@garden/ui/components/ui/tooltip'
import { Markdown } from '../../common/markdown'

function isMarkdown(path: string) {
  return path.endsWith('.md') || path.endsWith('.mdx')
}

// ---------------------------------------------------------------------------
// YAML frontmatter parsing
// ---------------------------------------------------------------------------

interface Frontmatter {
  [key: string]: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function parseFrontmatter(raw: string): {
  frontmatter: Frontmatter | null
  body: string
} {
  const match = FRONTMATTER_RE.exec(raw)
  if (!match) return { frontmatter: null, body: raw }

  const yamlBlock = match[1]!
  const body = raw.slice(match[0].length)
  const frontmatter: Frontmatter = {}

  for (const line of yamlBlock.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) frontmatter[key] = value
  }

  return {
    frontmatter: Object.keys(frontmatter).length > 0 ? frontmatter : null,
    body,
  }
}

// ---------------------------------------------------------------------------
// Frontmatter display
// ---------------------------------------------------------------------------

function FrontmatterCard({ data }: { data: Frontmatter }) {
  // Only surface the fields that actually matter when reading a skill. The
  // raw YAML block adds noise (type, version, metadata, etc.) that users
  // don't need in the rendered view.
  const visible = (['name', 'description'] as const)
    .map((key) => [key, data[key]] as const)
    .filter(([, value]) => typeof value === 'string' && value.length > 0)

  if (visible.length === 0) return null

  return (
    <dl className="mb-6 space-y-1 border-l-2 border-border/60 pl-3">
      {visible.map(([key, value]) => (
        <div key={key} className="text-[13px] leading-snug">
          <dt className="inline text-muted-foreground">
            {key}:{' '}
          </dt>
          <dd className="inline text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

// ---------------------------------------------------------------------------
// File viewer
// ---------------------------------------------------------------------------

export function FileViewer({
  path,
  content,
  onChange,
  readOnly = false,
}: {
  path: string
  content: string
  onChange?: (content: string) => void
  readOnly?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const isMd = isMarkdown(path)
  const canEdit = !readOnly
  const isEditing = canEdit && editing

  const { frontmatter, body } = useMemo(
    () =>
      isMd ? parseFrontmatter(content) : { frontmatter: null, body: content },
    [content, isMd],
  )

  return (
    <div className="flex h-full flex-col">
      {/* File header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-4">
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {path}
        </span>
        <div className="flex items-center gap-1">
          {isMd && canEdit ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setEditing((v) => !v)}
                    className="text-muted-foreground"
                  >
                    {isEditing ? <Eye /> : <Pencil />}
                  </Button>
                }
              />
              <TooltipContent>{isEditing ? 'Preview' : 'Edit'}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {/* File content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isMd && !isEditing ? (
          <div className="mx-auto max-w-3xl px-6 py-6">
            {frontmatter ? <FrontmatterCard data={frontmatter} /> : null}
            <Markdown mode="full">{body || '*No content yet*'}</Markdown>
          </div>
        ) : (
          <Textarea
            value={content}
            readOnly={readOnly}
            onChange={
              readOnly
                ? undefined
                : (event) => onChange?.(event.target.value)
            }
            placeholder={isMd ? 'Write markdown content…' : 'File content…'}
            className="h-full min-h-full resize-none rounded-none border-0 bg-transparent px-6 py-5 font-mono text-sm leading-relaxed focus-visible:ring-0"
          />
        )}
      </div>
    </div>
  )
}
