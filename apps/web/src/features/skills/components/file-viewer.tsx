import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ChevronDown } from 'lucide-react'
import { Textarea } from '@garden/ui/components/ui/textarea'
import { cn } from '@garden/ui/lib/utils'
import { Markdown } from '../../common/markdown'

export type SkillView = 'preview' | 'source' | 'edit'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

/** Separates YAML for presentation without reinterpreting or dropping nested fields. */
function splitDocument(content: string) {
  const match = FRONTMATTER_RE.exec(content)
  const frontmatter = match?.[1]
  return {
    frontmatter,
    fieldCount:
      frontmatter?.split('\n').filter((line) => /^\S[^:]*:/.test(line))
        .length ?? 0,
    body: match ? content.slice(match[0].length) : content,
  }
}

/**
 * Gives the skill reader a full-width preview, raw source, or editable document.
 * The old file header repeated the title and frontmatter crowded narrow screens.
 * The #159 references put metadata behind a disclosure and the desktop outline
 * beside prose. Heading discovery uses the shared Markdown renderer's actual DOM.
 */
export function FileViewer({
  path,
  content,
  onChange,
  mode = 'preview',
  intro,
  disabled = false,
}: {
  path: string
  content: string
  onChange?: (content: string) => void
  mode?: SkillView
  intro?: ReactNode
  disabled?: boolean
}) {
  const isMarkdown = /\.mdx?$/i.test(path)
  const document = useMemo(() => splitDocument(content), [content])
  const outlineId = useId()
  const [headings, setHeadings] = useState<HTMLElement[]>([])
  const [activeHeading, setActiveHeading] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const outlineRef = useRef<HTMLElement>(null)

  /**
   * The outline previously highlighted entries outside its viewport. Reveal a
   * newly active entry by moving only this panel, since scrollIntoView can also
   * move ancestor containers and disturb the document's reading position.
   */
  const revealActiveHeading = useCallback((entry: HTMLButtonElement | null) => {
    const outline = outlineRef.current
    if (!entry || !outline || outline.clientHeight === 0) return
    const top = outline.getBoundingClientRect().top + outline.clientTop
    const bottom = top + outline.clientHeight
    const bounds = entry.getBoundingClientRect()
    // Round outward so scrollTop quantization cannot leave a fractional pixel clipped.
    if (bounds.top < top) {
      outline.scrollTop = Math.floor(outline.scrollTop + bounds.top - top)
    } else if (bounds.bottom > bottom) {
      outline.scrollTop = Math.ceil(outline.scrollTop + bounds.bottom - bottom)
    }
  }, [])

  /** Registers rendered headings, including duplicate titles, without parsing Markdown twice. */
  const registerHeadings = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return
      const elements = Array.from(
        node.querySelectorAll<HTMLElement>('h1, h2, h3'),
      )
      elements.forEach((element, index) => {
        element.id = `${outlineId}-${index}`
      })
      setHeadings(elements)
      setActiveHeading(elements[0]?.id ?? '')
    },
    [outlineId],
  )

  /** Keeps the outline in step with the document's own scroll container. */
  const updateActiveHeading = () => {
    const top = scrollRef.current?.getBoundingClientRect().top ?? 0
    const current = headings
      .filter((heading) => heading.getBoundingClientRect().top <= top + 40)
      .at(-1)
    setActiveHeading(current?.id ?? headings[0]?.id ?? '')
  }

  return (
    <div className="flex h-full min-h-0 min-w-0">
      <div
        ref={scrollRef}
        onScroll={updateActiveHeading}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex min-h-full min-w-0 max-w-4xl flex-col px-5 py-4 md:px-8 md:py-8 lg:px-10">
          {intro}
          {mode === 'edit' ? (
            <Textarea
              aria-label={`Edit ${path}`}
              value={content}
              readOnly={disabled}
              onChange={(event) => onChange?.(event.target.value)}
              placeholder="File content…"
              spellCheck={false}
              className="min-h-80 flex-1 resize-none rounded-xl bg-muted/20 p-4 font-mono text-sm leading-relaxed [overflow-wrap:anywhere] md:min-h-96"
            />
          ) : mode === 'source' || !isMarkdown ? (
            <pre
              aria-label={`Source of ${path}`}
              className="min-w-0 whitespace-pre-wrap rounded-xl bg-muted/30 p-4 font-mono text-sm leading-relaxed [overflow-wrap:anywhere]"
            >
              {content || 'No content yet'}
            </pre>
          ) : (
            <>
              {document.frontmatter !== undefined ? (
                <details className="group mb-7 min-w-0 rounded-xl border">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-muted-foreground focus-visible:rounded-xl focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                    <span>
                      Frontmatter · {document.fieldCount}{' '}
                      {document.fieldCount === 1 ? 'field' : 'fields'}
                    </span>
                    <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
                  </summary>
                  <pre className="min-w-0 whitespace-pre-wrap border-t px-4 py-3 font-mono text-xs leading-relaxed [overflow-wrap:anywhere]">
                    {document.frontmatter}
                  </pre>
                </details>
              ) : null}
              <div
                key={document.body}
                ref={registerHeadings}
                className="min-w-0 [overflow-wrap:anywhere] [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_h1]:scroll-mt-6 [&_h2]:scroll-mt-6 [&_h3]:scroll-mt-6 [&_pre]:[overflow-wrap:normal]"
              >
                <Markdown mode="full">
                  {document.body || '*No content yet*'}
                </Markdown>
              </div>
            </>
          )}
        </div>
      </div>
      {mode === 'preview' && isMarkdown && headings.length > 0 ? (
        <nav
          ref={outlineRef}
          aria-label="On this page"
          className="hidden w-44 shrink-0 overflow-y-auto border-l px-4 py-9 xl:block 2xl:w-52"
        >
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            On this page
          </h2>
          <ul>
            {headings.map((heading) => (
              <li key={heading.id}>
                <button
                  ref={
                    activeHeading === heading.id
                      ? revealActiveHeading
                      : undefined
                  }
                  type="button"
                  aria-current={
                    activeHeading === heading.id ? 'location' : undefined
                  }
                  onClick={() => {
                    heading.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    })
                    setActiveHeading(heading.id)
                  }}
                  className={cn(
                    'min-h-11 w-full border-l-2 px-3 py-2 text-left text-xs [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-ring',
                    activeHeading === heading.id
                      ? 'border-primary font-semibold text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground',
                    heading.tagName === 'H3' && 'pl-5',
                  )}
                >
                  {heading.textContent}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  )
}
