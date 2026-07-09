import * as React from 'react'
import {
  Markdown as MarkdownBase,
  type MarkdownProps as MarkdownBaseProps,
  type RenderMode,
} from '@garden/ui/markdown'
import { useConfigStore } from '@garden/app-state/config'
import { IssueMentionCard } from '../issues/components/issue-mention-card'
import { MemberMentionTag } from './member-mention-tag'

export type { RenderMode }

export type MarkdownProps = MarkdownBaseProps

/**
 * Default renderMention that delegates to IssueMentionCard for issue mentions
 * and renders a styled span for other mention types.
 */
function defaultRenderMention({
  type,
  id,
  label,
}: {
  type: string
  id: string
  label?: string
}): React.ReactNode {
  if (type === 'issue') {
    return <IssueMentionCard issueId={id} />
  }
  if (type === 'member' || type === 'agent' || type === 'all') {
    return <MemberMentionTag type={type} id={id} label={label} />
  }
  return null
}

/**
 * App-level Markdown wrapper that injects IssueMentionCard via renderMention
 * and cdnDomain from the config store for file card rendering.
 */
export function Markdown(props: MarkdownProps): React.JSX.Element {
  const cdnDomain = useConfigStore((s) => s.cdnDomain)
  return (
    <MarkdownBase
      renderMention={defaultRenderMention}
      cdnDomain={cdnDomain}
      {...props}
    />
  )
}
