import { mergeAttributes, Node } from '@tiptap/core'
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react'
import { Download, FileText, Loader2 } from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'

const FILE_MARKDOWN = /^!file\[([^\]]*)\]\((https?:\/\/[^)]+)\)/

/** Visual node for a file attachment embedded in editor content. */
function FileCardView({ node }: NodeViewProps) {
  const href = String(node.attrs.href || '')
  const filename = String(node.attrs.filename || '')
  const uploading = Boolean(node.attrs.uploading)

  return (
    <NodeViewWrapper as="div" className="file-card-node" data-type="fileCard">
      <div
        contentEditable={false}
        className="my-1 flex items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-1 transition-colors hover:bg-muted"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {uploading ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <FileText className="size-4 shrink-0 text-muted-foreground" />
        )}
        <p className="min-w-0 flex-1 truncate text-sm">
          {uploading ? `Uploading ${filename}` : filename}
        </p>
        {!uploading && href ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            aria-label={`Download ${filename}`}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              window.open(href, '_blank', 'noopener,noreferrer')
            }}
          >
            <Download />
          </Button>
        ) : null}
      </div>
    </NodeViewWrapper>
  )
}

/**
 * Defines the atomic file-card node and its unambiguous `!file[name](url)`
 * Markdown round trip. Legacy syntax is handled by the preprocessing pipeline.
 */
export const FileCardExtension = Node.create({
  name: 'fileCard',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      href: { default: '', rendered: false },
      filename: { default: '', rendered: false },
      fileSize: { default: 0, rendered: false },
      uploading: { default: false, rendered: false },
      uploadId: { default: null, rendered: false },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="fileCard"]',
        getAttrs: (element) => ({
          href: (element as HTMLElement).dataset.href ?? '',
          filename: (element as HTMLElement).dataset.filename ?? '',
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'fileCard',
        'data-href': node.attrs.href,
        'data-filename': node.attrs.filename,
      }),
    ]
  },

  markdownTokenizer: {
    name: 'fileCard',
    level: 'block' as const,
    start: (source: string) => source.search(/^!file\[/m),
    tokenize(source: string) {
      const match = FILE_MARKDOWN.exec(source)
      if (!match) return undefined
      return {
        type: 'fileCard',
        raw: match[0],
        attributes: { filename: match[1], href: match[2] },
      }
    },
  },
  parseMarkdown: (token: any, helpers: any) =>
    helpers.createNode('fileCard', token.attributes),
  renderMarkdown: (node: any) => {
    const filename = node.attrs?.filename || 'file'
    const href = node.attrs?.href || ''
    return `!file[${filename}](${href})`
  },

  addNodeView: () => ReactNodeViewRenderer(FileCardView),
})
