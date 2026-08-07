import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@garden/ui/components/ui/tooltip'
import { cn } from '@garden/ui/lib/utils'

export interface CodeBlockProps {
  code: string
  language?: string
  className?: string
  mode?: 'terminal' | 'minimal' | 'full'
}

/**
 * Renders code without an asynchronous highlighter, keeping streamed content
 * immediate and deterministic while retaining language and copy affordances.
 */
export function CodeBlock({
  code,
  language = 'text',
  className,
  mode = 'full',
}: CodeBlockProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  const copyCode = () => {
    void navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2_000)
      },
      () => setCopied(false),
    )
  }

  if (mode !== 'full') {
    return (
      <pre
        className={cn(
          'overflow-x-auto whitespace-pre-wrap break-words font-mono text-sm',
          mode === 'minimal' && 'rounded-md bg-muted/40 p-2',
          className,
        )}
      >
        <code>{code}</code>
      </pre>
    )
  }

  return (
    <figure
      className={cn(
        'group mb-4 overflow-hidden rounded-lg border bg-muted/30 last:mb-0',
        className,
      )}
    >
      <figcaption className="flex items-center justify-between border-b bg-muted/50 px-3 py-1.5 text-xs">
        <span className="font-medium uppercase tracking-wide text-muted-foreground">
          {language === 'text' ? 'plain text' : language}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                aria-label="Copy code"
                onClick={copyCode}
              >
                {copied ? <Check className="text-success" /> : <Copy />}
              </Button>
            }
          />
          <TooltipContent>{copied ? 'Copied' : 'Copy code'}</TooltipContent>
        </Tooltip>
      </figcaption>
      <pre className="overflow-x-auto whitespace-pre p-3 font-mono text-sm">
        <code>{code}</code>
      </pre>
    </figure>
  )
}

export function InlineCode({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <code
      className={cn(
        'rounded border border-foreground/5 bg-foreground/[0.03] px-1.5 py-0.5 font-mono text-sm text-foreground/80',
        className,
      )}
    >
      {children}
    </code>
  )
}
