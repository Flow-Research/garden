import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { Copy, Check } from 'lucide-react'
import { useCopyToClipboard } from '@garden/ui/hooks/use-copy-to-clipboard'

function CodeBlockView({ node }: NodeViewProps) {
  const { copied, copy } = useCopyToClipboard()
  const language = node.attrs.language || ''

  const handleCopy = () => {
    const text = node.textContent
    if (text) void copy(text)
  }

  return (
    <NodeViewWrapper className="code-block-wrapper group/code relative my-2">
      <div
        contentEditable={false}
        className="code-block-header absolute top-0 right-0 z-10 flex items-center gap-1.5 px-2 py-1.5 opacity-0 transition-opacity group-hover/code:opacity-100"
      >
        {language && (
          <span className="text-xs text-muted-foreground select-none">
            {language}
          </span>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title="Copy code"
          aria-label={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </button>
      </div>
      <pre spellCheck={false}>
        {/* @ts-expect-error -- NodeViewContent supports as="code" at runtime */}
        <NodeViewContent as="code" />
      </pre>
    </NodeViewWrapper>
  )
}

export { CodeBlockView }
