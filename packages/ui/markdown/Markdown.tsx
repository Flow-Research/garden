import { useMemo, type ReactNode } from 'react'
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { Download, FileText } from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'
import { cn } from '@garden/ui/lib/utils'
import { CodeBlock, InlineCode } from './CodeBlock'
import { preprocessFileCards } from './file-cards'
import { preprocessLinks } from './linkify'
import { preprocessMentionShortcodes } from './mentions'

export type RenderMode = 'terminal' | 'minimal' | 'full'

interface MentionDescriptor {
  type: string
  id: string
  label?: string
}

export interface MarkdownProps {
  children: string
  mode?: RenderMode
  className?: string
  id?: string
  onUrlClick?: (url: string) => void
  onFileClick?: (path: string) => void
  renderMention?: (mention: MentionDescriptor) => ReactNode
  cdnDomain?: string
}

const FILE_PATH = /^(?:\/|~\/|\.\/).+\.[a-z0-9]+$/i
const MENTION_LINK = /^mention:\/\/(member|agent|issue|all)\/(.+)$/

const sanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), 'mention'],
  },
  attributes: {
    ...defaultSchema.attributes,
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      'dataType',
      'dataHref',
      'dataFilename',
    ],
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ['className', /^language-/],
    ],
  },
}

function safeUrl(url: string): string {
  return url.startsWith('mention://') ? url : defaultUrlTransform(url)
}

function textLabel(children: ReactNode): string | undefined {
  return typeof children === 'string' ? children.replace(/^@/, '') : undefined
}

function FileCard({ href, filename }: { href: string; filename: string }) {
  const safeHref = /^https?:\/\//i.test(href) ? href : ''
  return (
    <div className="my-1 flex items-center gap-2 rounded-md border bg-muted/50 px-2.5 py-1">
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm">{filename}</span>
      {safeHref ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          aria-label={`Download ${filename}`}
          onClick={() => window.open(safeHref, '_blank', 'noopener,noreferrer')}
        >
          <Download />
        </Button>
      ) : null}
    </div>
  )
}

/** Builds the renderer contract for one presentation density. */
function markdownComponents(
  mode: RenderMode,
  props: Pick<MarkdownProps, 'onUrlClick' | 'onFileClick' | 'renderMention'>,
): Components {
  const terminal = mode === 'terminal'
  const full = mode === 'full'

  return {
    div: ({ node, children, ...divProps }) =>
      node?.properties?.dataType === 'fileCard' ? (
        <FileCard
          href={String(node.properties.dataHref ?? '')}
          filename={String(node.properties.dataFilename ?? '')}
        />
      ) : (
        <div {...divProps}>{children}</div>
      ),
    img: ({ src, alt }) => (
      <img
        src={src}
        alt={alt ?? ''}
        loading="lazy"
        className="my-2 h-auto max-w-full rounded-md"
      />
    ),
    a: ({ href = '', children }) => {
      const mention = MENTION_LINK.exec(href)
      if (mention?.[1] && mention[2]) {
        const rendered = props.renderMention?.({
          type: mention[1],
          id: mention[2],
          label: textLabel(children),
        })
        return rendered ? (
          <>{rendered}</>
        ) : (
          <span className="mx-0.5 font-semibold text-primary">{children}</span>
        )
      }

      return (
        <a
          href={href}
          className="cursor-pointer text-primary hover:underline"
          onClick={(event) => {
            event.preventDefault()
            if (FILE_PATH.test(href) && props.onFileClick)
              props.onFileClick(href)
            else if (props.onUrlClick) props.onUrlClick(href)
            else window.open(href, '_blank', 'noopener,noreferrer')
          }}
        >
          {children}
        </a>
      )
    },
    code: ({ className, children, node }) => {
      const language = /language-(\w+)/.exec(className ?? '')?.[1]
      const block = Boolean(
        language ||
        (node?.position && node.position.start.line !== node.position.end.line),
      )
      const value = String(children).replace(/\n$/, '')
      return block ? (
        <CodeBlock
          code={value}
          language={language}
          mode={terminal ? 'terminal' : full ? 'full' : 'minimal'}
        />
      ) : (
        <InlineCode>{children}</InlineCode>
      )
    },
    pre: ({ children }) => <>{children}</>,
    p: ({ children }) => (
      <p className={terminal ? 'my-1' : 'my-2 leading-relaxed'}>{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="my-2 list-disc space-y-1 ps-5 marker:text-muted-foreground">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="my-2 list-decimal space-y-1 ps-6">{children}</ol>
    ),
    li: ({ children }) => (
      <li className={terminal ? 'my-0.5' : undefined}>{children}</li>
    ),
    table: ({ children }) => (
      <div className={cn('my-3 overflow-x-auto', full && 'rounded-md border')}>
        <table className="min-w-full text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className={cn('border-b', full && 'bg-muted/50')}>
        {children}
      </thead>
    ),
    tbody: ({ children }) => (
      <tbody className={full ? 'divide-y divide-border' : undefined}>
        {children}
      </tbody>
    ),
    th: ({ children }) => (
      <th className="px-3 py-2 text-left font-semibold">{children}</th>
    ),
    td: ({ children }) => (
      <td className="border-b border-border/50 px-3 py-2">{children}</td>
    ),
    h1: ({ children }) => (
      <h1 className="mb-3 mt-5 text-base font-bold">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="mb-3 mt-4 text-base font-semibold">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-2 mt-4 text-sm font-semibold">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="mb-1 mt-3 text-sm font-semibold">{children}</h4>
    ),
    blockquote: ({ children }) => (
      <blockquote
        className={cn(
          'my-2 border-l pl-3 text-muted-foreground',
          full && 'rounded-r-md bg-muted/30 py-2 pr-3',
        )}
      >
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-4 border-border" />,
    input: ({ type, checked }) =>
      type === 'checkbox' ? (
        <input type="checkbox" checked={checked} readOnly className="mr-2" />
      ) : (
        <input type={type} />
      ),
  }
}

/** Secure Markdown renderer shared by compact messages and long-form files. */
export function Markdown(props: MarkdownProps): React.JSX.Element {
  const mode = props.mode ?? 'minimal'
  const components = useMemo(
    () => markdownComponents(mode, props),
    [mode, props.onFileClick, props.onUrlClick, props.renderMention],
  )
  const content = useMemo(
    () =>
      [
        preprocessMentionShortcodes,
        preprocessLinks,
        (value: string) => preprocessFileCards(value, props.cdnDomain ?? ''),
      ].reduce((value, transform) => transform(value), props.children),
    [props.children, props.cdnDomain],
  )

  return (
    <div
      className={cn('markdown-content break-words', props.className)}
      data-markdown-id={props.id}
    >
      <ReactMarkdown
        remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        urlTransform={safeUrl}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
