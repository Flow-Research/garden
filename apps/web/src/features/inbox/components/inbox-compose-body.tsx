import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Input } from '@garden/ui/components/ui/input'

export type ComposeMessageBodyRef = {
  insertText: (text: string) => void
  insertLink: (text: string, href: string) => void
  clear: () => void
  getMarkdown: () => string
  saveSelection: () => void
}

type ComposeMessageBodyProps = {
  placeholder: string
  initialText?: string
  onChange: (markdown: string) => void
}

type LinkInspectorState = {
  id: string
  text: string
  href: string
  top: number
  left: number
}

/**
 * Message field that can host inline link atoms. A textarea cannot style a
 * labeled URL as display-text-only, so this contenteditable inserts
 * `contenteditable=false` anchors and opens a Docs-style inspector on click
 * (go to / change / remove).
 */
export const ComposeMessageBody = forwardRef<
  ComposeMessageBodyRef,
  ComposeMessageBodyProps
>(function ComposeMessageBody({ placeholder, initialText, onChange }, ref) {
  const editorRef = useRef<HTMLDivElement>(null)
  const savedRangeRef = useRef<Range | null>(null)
  const [empty, setEmpty] = useState(
    () => !(initialText && initialText.length > 0),
  )
  const [inspector, setInspector] = useState<LinkInspectorState | null>(null)
  const [editingHref, setEditingHref] = useState(false)
  const [hrefDraft, setHrefDraft] = useState('')

  const syncBody = () => {
    const root = editorRef.current
    if (!root) return
    const markdown = serializeComposeBody(root)
    setEmpty(markdown.length === 0)
    onChange(markdown)
  }

  const insertNode = (node: Node) => {
    const root = editorRef.current
    if (!root) return
    root.focus()

    let range: Range | null = savedRangeRef.current
    if (range && !root.contains(range.startContainer)) {
      range = null
    }
    if (!range) {
      const selection = window.getSelection()
      if (
        selection != null &&
        selection.rangeCount > 0 &&
        selection.anchorNode != null &&
        root.contains(selection.anchorNode)
      ) {
        range = selection.getRangeAt(0)
      }
    }

    if (!range) {
      root.appendChild(node)
      root.appendChild(document.createTextNode('\u00a0'))
      syncBody()
      return
    }

    range.deleteContents()
    range.insertNode(node)
    const spacer = document.createTextNode('\u00a0')
    node.parentNode?.insertBefore(spacer, node.nextSibling)
    range.setStartAfter(spacer)
    range.collapse(true)

    const selection = window.getSelection()
    if (selection) {
      selection.removeAllRanges()
      selection.addRange(range)
    }
    savedRangeRef.current = range.cloneRange()
    syncBody()
  }

  const closeInspector = () => {
    setInspector(null)
    setEditingHref(false)
    setHrefDraft('')
  }

  useImperativeHandle(ref, () => ({
    insertText: (text: string) => {
      insertNode(document.createTextNode(text))
    },
    insertLink: (text: string, href: string) => {
      insertNode(createComposeLink(text, href))
    },
    clear: () => {
      const root = editorRef.current
      if (root) root.innerHTML = ''
      closeInspector()
      setEmpty(true)
      onChange('')
    },
    getMarkdown: () => {
      const root = editorRef.current
      return root ? serializeComposeBody(root) : ''
    },
    saveSelection: () => {
      const root = editorRef.current
      if (!root) return
      const selection = window.getSelection()
      if (
        selection != null &&
        selection.rangeCount > 0 &&
        selection.anchorNode != null &&
        root.contains(selection.anchorNode)
      ) {
        savedRangeRef.current = selection.getRangeAt(0).cloneRange()
      }
    },
  }))

  const findLink = (id: string) =>
    editorRef.current?.querySelector<HTMLAnchorElement>(
      `a[data-compose-link-id="${id}"]`,
    )

  const openInspector = (anchor: HTMLAnchorElement) => {
    const rect = anchor.getBoundingClientRect()
    setInspector({
      id: anchor.dataset.composeLinkId ?? '',
      text: anchor.textContent ?? '',
      href: anchor.getAttribute('href') ?? '',
      top: rect.bottom + 8,
      left: rect.left,
    })
    setEditingHref(false)
    setHrefDraft(anchor.getAttribute('href') ?? '')
  }

  const applyHrefChange = () => {
    if (!inspector) return
    const href = normalizeHref(hrefDraft.trim())
    if (href.length === 0) return
    const anchor = findLink(inspector.id)
    if (anchor) anchor.setAttribute('href', href)
    setInspector({ ...inspector, href })
    setEditingHref(false)
    syncBody()
  }

  const removeLink = () => {
    if (!inspector) return
    const anchor = findLink(inspector.id)
    if (anchor) {
      const text = document.createTextNode(anchor.textContent ?? '')
      anchor.replaceWith(text)
    }
    closeInspector()
    syncBody()
  }

  return (
    <div className="relative min-h-52 resize-y overflow-auto bg-muted">
      {empty ? (
        <span className="pointer-events-none absolute top-4 left-4 text-sm text-muted-foreground">
          {placeholder}
        </span>
      ) : null}
      <div
        ref={(node) => {
          editorRef.current = node
          if (node && initialText && !node.dataset.prefilled) {
            node.dataset.prefilled = 'true'
            node.innerText = initialText
          }
        }}
        id="inbox-compose-body"
        role="textbox"
        aria-multiline="true"
        aria-label="Message"
        contentEditable
        suppressContentEditableWarning
        className="min-h-52 px-4 py-4 text-sm text-foreground outline-none"
        onInput={syncBody}
        onClick={(event) => {
          const target = event.target
          if (!(target instanceof Element)) return
          const anchor = target.closest<HTMLAnchorElement>(
            'a[data-compose-link]',
          )
          if (!anchor) return
          event.preventDefault()
          event.stopPropagation()
          openInspector(anchor)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.stopPropagation()
        }}
      />
      {inspector
        ? createPortal(
            <LinkInspectorCard
              inspector={inspector}
              editingHref={editingHref}
              hrefDraft={hrefDraft}
              onHrefDraftChange={setHrefDraft}
              onStartEdit={() => setEditingHref(true)}
              onSaveHref={applyHrefChange}
              onCancelEdit={() => {
                setEditingHref(false)
                setHrefDraft(inspector.href)
              }}
              onRemove={removeLink}
              onClose={closeInspector}
            />,
            document.body,
          )
        : null}
    </div>
  )
})

function LinkInspectorCard({
  inspector,
  editingHref,
  hrefDraft,
  onHrefDraftChange,
  onStartEdit,
  onSaveHref,
  onCancelEdit,
  onRemove,
  onClose,
}: {
  inspector: LinkInspectorState
  editingHref: boolean
  hrefDraft: string
  onHrefDraftChange: (value: string) => void
  onStartEdit: () => void
  onSaveHref: () => void
  onCancelEdit: () => void
  onRemove: () => void
  onClose: () => void
}) {
  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-60 cursor-default"
        aria-label="Close link details"
        onClick={onClose}
      />
      <div
        className="fixed z-70 min-w-64 rounded-md border border-border bg-popover px-3 py-2 text-sm shadow-md"
        style={{ top: inspector.top, left: inspector.left }}
      >
        <p className="font-medium text-info underline decoration-info/40 underline-offset-2">
          {inspector.text}
        </p>
        {editingHref ? (
          <div className="mt-2 flex items-center gap-2">
            <Input
              autoFocus
              value={hrefDraft}
              onChange={(event) => onHrefDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onSaveHref()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  onCancelEdit()
                }
              }}
              className="h-7"
            />
            <button
              type="button"
              className="shrink-0 text-xs font-medium text-info hover:underline"
              onClick={onSaveHref}
            >
              Save
            </button>
          </div>
        ) : (
          <p className="mt-1 text-muted-foreground">
            Go to link:{' '}
            <a
              href={inspector.href}
              target="_blank"
              rel="noreferrer"
              className="text-info hover:underline"
            >
              {inspector.href}
            </a>
            {' | '}
            <button
              type="button"
              className="text-info hover:underline"
              onClick={onStartEdit}
            >
              Change
            </button>
            {' | '}
            <button
              type="button"
              className="text-info hover:underline"
              onClick={onRemove}
            >
              Remove
            </button>
          </p>
        )}
      </div>
    </>
  )
}

function createComposeLink(text: string, href: string) {
  const anchor = document.createElement('a')
  const label = text.trim().length > 0 ? text.trim() : href
  anchor.href = href
  anchor.textContent = label
  anchor.contentEditable = 'false'
  anchor.dataset.composeLink = 'true'
  anchor.dataset.composeLinkId = crypto.randomUUID()
  anchor.className =
    'text-info underline decoration-info/40 underline-offset-2 cursor-pointer'
  return anchor
}

function serializeComposeBody(root: HTMLElement) {
  let markdown = ''
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      markdown += node.textContent ?? ''
      return
    }
    if (node instanceof HTMLAnchorElement && node.dataset.composeLink) {
      const label = node.textContent ?? ''
      const href = node.getAttribute('href') ?? ''
      markdown += `[${label}](${href})`
      return
    }
    node.childNodes.forEach((child) => walk(child))
  }
  walk(root)
  return markdown.replace(/\u00a0/g, ' ').trim()
}

export function normalizeHref(value: string) {
  if (value.length === 0) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value
  return `https://${value}`
}
