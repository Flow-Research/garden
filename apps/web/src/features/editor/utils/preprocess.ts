import {
  preprocessFileCards,
  preprocessLinks,
  preprocessMentionShortcodes,
} from '@garden/ui/markdown'
import { configStore } from '@garden/app-state/config'

type MarkdownTransform = (markdown: string) => string

/**
 * Normalizes persisted legacy syntax before Tiptap or the readonly renderer
 * parses Markdown. Each transform remains independently testable and ordered.
 */
export function preprocessMarkdown(markdown: string): string {
  if (!markdown) return ''

  const cdnDomain = configStore.getState().cdnDomain
  const transforms: MarkdownTransform[] = [
    preprocessMentionShortcodes,
    preprocessLinks,
    (value) => preprocessFileCards(value, cdnDomain),
  ]

  return transforms.reduce((value, transform) => transform(value), markdown)
}
