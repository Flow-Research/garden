export type MentionLinkType = 'member' | 'agent' | 'issue' | 'all'

/** Escapes user-controlled labels without changing their rendered text. */
export function escapeMentionLabel(label: string): string {
  return label
    .replace(/[\r\n]+/g, ' ')
    .replace(
      /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g,
      (character) => `\\${character}`,
    )
}

/** Reverses Markdown escapes captured by the editor mention tokenizer. */
export function unescapeMentionLabel(label: string): string {
  return label.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1')
}

/** Serializes every mention surface through one safe canonical contract. */
export function serializeMentionMarkdown(args: {
  id: string
  label: string
  type: MentionLinkType
}): string {
  const prefix = args.type === 'issue' ? '' : '@'
  return `[${prefix}${escapeMentionLabel(args.label)}](mention://${args.type}/${args.id})`
}

/**
 * Convert legacy mention shortcodes [@ id="UUID" label="LABEL"] to the
 * standard markdown link format [@LABEL](mention://member/UUID).
 *
 * These shortcodes exist in older database records from a previous mention
 * serialization format. This function normalises them so downstream parsers
 * (Tiptap @tiptap/markdown, react-markdown) only need to handle one syntax.
 */
export function preprocessMentionShortcodes(text: string): string {
  if (!text.includes('[@ ')) return text
  return text.replace(/\[@\s+([^\]]*)\]/g, (match, attrString: string) => {
    const attrs: Record<string, string> = {}
    const re = /(\w+)="([^"]*)"/g
    let m
    while ((m = re.exec(attrString)) !== null) {
      if (m[1] && m[2] !== undefined) attrs[m[1]] = m[2]
    }
    const { id, label } = attrs
    if (!id || !label) return match
    return serializeMentionMarkdown({ id, label, type: 'member' })
  })
}
