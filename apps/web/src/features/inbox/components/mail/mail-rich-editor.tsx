import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

/**
 * Zero-derived HTML composer editor. Tiptap owns document state and emits both
 * safe-to-sanitize HTML and a plain-text alternative on every user edit.
 */
export function MailRichEditor({
  html,
  disabled,
  onChange,
  onReady,
}: {
  html: string
  disabled: boolean
  onChange: (value: { html: string; text: string }) => void
  onReady: (editor: Editor | null) => void
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        },
      }),
    ],
    content: html,
    editable: !disabled,
    editorProps: {
      attributes: {
        'aria-label': 'Message body',
        class:
          'min-h-48 w-full px-0 py-2 text-sm outline-none [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5',
      },
    },
    onCreate: ({ editor: created }) => onReady(created),
    onDestroy: () => onReady(null),
    onUpdate: ({ editor: updated }) =>
      onChange({ html: updated.getHTML(), text: updated.getText() }),
  })

  return <EditorContent editor={editor} />
}
