import Mention from '@tiptap/extension-mention'
import { mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import {
  serializeMentionMarkdown,
  unescapeMentionLabel,
  type MentionLinkType,
} from '@garden/ui/markdown'
import { MentionView } from './mention-view'

const MENTION_MARKDOWN_START = /\[@?(?:\\.|[^\]])+\]\(mention:\/\//
const MENTION_MARKDOWN_TOKEN =
  /^\[@?((?:\\.|[^\]])+)\]\(mention:\/\/(\w+)\/([^)]+)\)/

function normalizedMentionType(value: unknown): MentionLinkType {
  return value === 'agent' || value === 'issue' || value === 'all'
    ? value
    : 'member'
}

/** Converts one serialized mention into the token shape Tiptap Markdown expects. */
function tokenizeMention(source: string) {
  const match = MENTION_MARKDOWN_TOKEN.exec(source)
  if (!match?.[0] || !match[1] || !match[3]) return undefined
  return {
    attributes: {
      id: match[3],
      label: unescapeMentionLabel(match[1]),
      type: normalizedMentionType(match[2]),
    },
    raw: match[0],
    type: 'mention',
  }
}

/** Shared mention node with Garden's actor/issue serialization contract. */
export const BaseMentionExtension = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      type: {
        default: 'member',
        parseHTML: (el: HTMLElement) =>
          el.getAttribute('data-mention-type') ?? 'member',
        renderHTML: () => ({}),
      },
    }
  },
  addNodeView: () => ReactNodeViewRenderer(MentionView),
  markdownTokenizer: {
    level: 'inline' as const,
    name: 'mention',
    start: (source: string) => source.search(MENTION_MARKDOWN_START),
    tokenize: tokenizeMention,
  },
  parseMarkdown: (token: any, helpers: any) =>
    helpers.createNode('mention', token.attributes),
  renderHTML({ HTMLAttributes, node }) {
    const type = normalizedMentionType(node.attrs.type)
    const label = String(node.attrs.label ?? node.attrs.id)
    const attributes = mergeAttributes(
      this.options.HTMLAttributes,
      HTMLAttributes,
      {
        'data-mention-id': node.attrs.id,
        'data-mention-type': type,
        'data-type': 'mention',
      },
    )
    return ['span', attributes, `${type === 'issue' ? '' : '@'}${label}`]
  },
  renderMarkdown: (node: any) => {
    const { id, label, type } = node.attrs ?? {}
    return serializeMentionMarkdown({
      id,
      label: label ?? id,
      type: normalizedMentionType(type),
    })
  },
})
