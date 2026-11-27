/**
 * Real-editor tests for the Tiptap and ProseMirror dependency family.
 *
 * `content-editor.test.tsx` replaces Tiptap with a mock. These tests do not.
 * They render the actual `ContentEditor` with Garden's extension set, and use
 * the installed `@tiptap/*` and `prosemirror-*` packages. They cover the paths
 * that issue, comment and reply editors use: Markdown load and save, typing,
 * marks, links, paste, and mentions.
 *
 * The security cases check the patched behavior of the installed releases:
 * - `@tiptap/core` Markdown attribute parsers finish in linear time
 *   (GHSA-j95f-988m-3j2f, fixed in 3.30.5).
 * - `mergeAttributes` does not take a prototype from an own `__proto__` key
 *   (GHSA-cp6q-959q-f8rh, fixed in 3.30.4). The mention node uses it.
 * - ProseMirror View validates attributes that come from the slice context
 *   of pasted HTML (GHSA-c8x8-7fp4-3x9w, fixed in 1.42.3).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Extension,
  createAtomBlockMarkdownSpec,
  createInlineMarkdownSpec,
  mergeAttributes,
  Editor as CoreEditor,
  type Editor,
} from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { DOMSerializer, Schema } from '@tiptap/pm/model'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import { NavigationProvider } from '../navigation'
import { ContentEditor } from './content-editor'
import { safeFileHref } from '@garden/ui/markdown'
import { ReadonlyContent } from './readonly-content'

const navigation = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  pathname: '/',
  searchParams: new URLSearchParams(),
}

type EditorElement = HTMLElement & { editor?: Editor }

async function renderEditor(
  props: { defaultValue?: string; editable?: boolean } = {},
) {
  const queryClient = new QueryClient()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId="ws-1">
        <NavigationProvider value={navigation}>
          <ContentEditor showBubbleMenu={false} {...props} />
        </NavigationProvider>
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
  const editor = await waitFor(() => {
    const dom = result.container.querySelector<EditorElement>('.ProseMirror')
    if (!dom?.editor) throw new Error('editor not mounted')
    return dom.editor
  })
  return { ...result, editor }
}

/**
 * Types text one character at a time through ProseMirror's text-input hook,
 * as the view does for a DOM text change. Input rules (Typography, Markdown
 * shortcuts) run first. When no handler takes the input, the text is
 * inserted with the same transaction the view would dispatch.
 */
function typeText(editor: Editor, text: string) {
  const view = editor.view
  for (const char of text) {
    const { from, to } = view.state.selection
    const handled = view.someProp('handleTextInput', (handle) =>
      handle(view, from, to, char, () => view.state.tr.insertText(char)),
    )
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to))
  }
}

// JSDOM has no ClipboardEvent. ProseMirror View only reads `clipboardData`.
vi.stubGlobal('ClipboardEvent', class ClipboardEvent extends Event {})

/** A paste event with the clipboard data that a browser gives the view. */
function pasteEvent(data: Record<string, string>) {
  const event = new ClipboardEvent('paste')
  Object.defineProperty(event, 'clipboardData', {
    value: { files: [], getData: (type: string) => data[type] ?? '' },
  })
  return event
}

function elapsedMs(run: () => void) {
  const started = performance.now()
  run()
  return performance.now() - started
}

afterEach(() => {
  cleanup()
})

describe('ContentEditor on the installed Tiptap and ProseMirror', () => {
  it('loads stored Markdown and saves the same structure', async () => {
    const markdown = [
      '# Release plan',
      '',
      'Some **bold**, *italic*, ~~old~~ and `code` text with a [link](https://example.com/docs).',
      '',
      '- first',
      '- second',
      '',
      '1. one',
      '2. two',
      '',
      '> quoted',
      '',
      '```ts',
      'const answer = 42',
      '```',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| a | b |',
    ].join('\n')
    const { editor } = await renderEditor({ defaultValue: markdown })

    const json = editor.getJSON()
    const types = (json.content ?? []).map((node) => node.type)
    expect(types).toEqual([
      'heading',
      'paragraph',
      'bulletList',
      'orderedList',
      'blockquote',
      'codeBlock',
      'table',
    ])

    const saved = editor.getMarkdown()
    expect(saved).toContain('# Release plan')
    expect(saved).toContain('**bold**')
    expect(saved).toContain('*italic*')
    expect(saved).toContain('~~old~~')
    expect(saved).toContain('`code`')
    expect(saved).toContain('[link](https://example.com/docs)')
    expect(saved).toContain('- first')
    expect(saved).toContain('1. one')
    expect(saved).toContain('> quoted')
    expect(saved).toContain('```ts\nconst answer = 42\n```')
    expect(saved).toMatch(/\| Name\s*\| Value\s*\|/)

    // A second load of the saved text saves the same text. Tiptap adds an
    // empty paragraph after a final table, so trailing blank lines differ.
    editor.commands.setContent(saved, { contentType: 'markdown' })
    expect(editor.getMarkdown().trimEnd()).toBe(saved.trimEnd())
  })

  it('keeps only http and https links on file cards from HTML', async () => {
    const { editor, container } = await renderEditor()
    const card = (href: string, filename: string) =>
      `<div data-type="fileCard" data-href="${href}" data-filename="${filename}"></div>`
    editor.commands.setContent(
      [
        card('https://cdn.example.com/a.pdf', 'a.pdf'),
        card('javascript:void(0)', 'b.pdf'),
        card('data:text/html,x', 'c.pdf'),
        card(' JAVASCRIPT:void(0)', 'd.pdf'),
      ].join(''),
    )
    const hrefs: Array<unknown> = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'fileCard') hrefs.push(node.attrs.href)
    })
    expect(hrefs).toEqual(['https://cdn.example.com/a.pdf', '', '', ''])
    await waitFor(() =>
      expect(
        container.querySelectorAll('button[aria-label^="Download"]'),
      ).toHaveLength(1),
    )
    expect(editor.getMarkdown()).not.toMatch(/javascript|data:/i)
  })

  it('accepts absolute http and https file links and rejects generic paths', () => {
    expect(safeFileHref('https://cdn.example.com/a.pdf')).toBe(
      'https://cdn.example.com/a.pdf',
    )
    expect(safeFileHref('HTTP://cdn.example.com/a.pdf')).toBe(
      'HTTP://cdn.example.com/a.pdf',
    )
    for (const value of [
      'javascript:void(0)',
      ' javascript:void(0)',
      'vbscript:x',
      'data:text/html,x',
      '/relative/path',
      'https:',
      '',
      undefined,
      42,
    ])
      expect(safeFileHref(value)).toBe('')
  })

  it('keeps Garden upload links through Markdown and HTML', async () => {
    const href = '/api/attachments/f293e0ac-4a07-4147-b82b-9d6c1f97abcd'
    const markdown = `!file[report.pdf](${href})`
    const { editor, container } = await renderEditor({ defaultValue: markdown })
    expect(editor.state.doc.firstChild?.attrs.href).toBe(href)
    expect(editor.getMarkdown().trim()).toBe(markdown)
    editor.commands.setContent(editor.getHTML())
    const saved = editor.getMarkdown().trim()
    expect(saved).toBe(markdown)
    const comment = render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspaceIdProvider wsId="ws-1">
          <NavigationProvider value={navigation}>
            <ReadonlyContent content={saved} />
          </NavigationProvider>
        </WorkspaceIdProvider>
      </QueryClientProvider>,
    )
    expect(
      comment.container
        .querySelector('a[download="report.pdf"]')
        ?.getAttribute('href'),
    ).toBe(href)
    await waitFor(() =>
      expect(
        container.querySelector('button[aria-label="Download report.pdf"]'),
      ).toBeTruthy(),
    )
  })

  it('keeps mention links and file cards through load and save', async () => {
    const markdown = [
      'Ask [@Ada Lovelace](mention://member/user-1) about [TST-1](mention://issue/issue-1).',
      '',
      '!file[report.pdf](https://cdn.example.com/report.pdf)',
    ].join('\n')
    const { editor } = await renderEditor({ defaultValue: markdown })

    const mentions: Array<Record<string, unknown>> = []
    let fileCard: Record<string, unknown> | undefined
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'mention') mentions.push(node.attrs)
      if (node.type.name === 'fileCard') fileCard = node.attrs
    })
    expect(mentions).toEqual([
      expect.objectContaining({
        id: 'user-1',
        label: 'Ada Lovelace',
        type: 'member',
      }),
      expect.objectContaining({ id: 'issue-1', label: 'TST-1', type: 'issue' }),
    ])
    expect(fileCard).toEqual(
      expect.objectContaining({
        filename: 'report.pdf',
        href: 'https://cdn.example.com/report.pdf',
      }),
    )

    const saved = editor.getMarkdown()
    expect(saved).toContain('[@Ada Lovelace](mention://member/user-1)')
    expect(saved).toContain('[TST\\-1](mention://issue/issue-1)')
    expect(saved).toContain(
      '!file[report.pdf](https://cdn.example.com/report.pdf)',
    )

    // The mention node renders its HTML through `mergeAttributes`.
    const html = editor.getHTML()
    expect(html).toContain('data-mention-id="user-1"')
    expect(html).toContain('data-mention-type="member"')
  })

  it('applies Markdown input rules and marks while the user types', async () => {
    const { editor } = await renderEditor()

    typeText(editor, '## ')
    typeText(editor, 'Heading')
    expect(editor.getJSON().content?.[0]).toEqual(
      expect.objectContaining({ type: 'heading', attrs: { level: 2 } }),
    )

    editor.commands.enter()
    typeText(editor, 'Plain **bold** and *soft* -- done')
    const paragraph = editor.state.doc.child(1)
    expect(paragraph.type.name).toBe('paragraph')
    expect(paragraph.textContent).toBe('Plain bold and soft — done')

    const marked: Record<string, string[]> = {}
    paragraph.forEach((child) => {
      if (child.marks.length)
        marked[child.text ?? ''] = child.marks.map((mark) => mark.type.name)
    })
    expect(marked).toEqual({ bold: ['bold'], soft: ['italic'] })

    editor.commands.selectAll()
    editor.commands.toggleStrike()
    expect(editor.getMarkdown()).toContain('~~')
  })

  it('links a typed URL and sets a link on selected text', async () => {
    const { editor } = await renderEditor()

    typeText(editor, 'See https://example.com/a ')
    const autolinked = editor.state.doc.firstChild
    let autoHref: unknown
    autolinked?.forEach((child) => {
      const link = child.marks.find((mark) => mark.type.name === 'link')
      if (link) autoHref = link.attrs.href
    })
    expect(autoHref).toBe('https://example.com/a')

    editor.commands.enter()
    typeText(editor, 'docs')
    const end = editor.state.selection.from
    editor
      .chain()
      .setTextSelection({ from: end - 4, to: end })
      .setLink({ href: 'https://example.com/docs' })
      .run()
    expect(editor.getMarkdown()).toContain('[docs](https://example.com/docs)')

    // The link extension refuses a script URL.
    editor
      .chain()
      .setTextSelection({ from: end - 4, to: end })
      .unsetLink()
      .setLink({ href: 'javascript:alert(1)' })
      .run()
    expect(editor.getHTML()).not.toContain('javascript:')
  })

  it('parses pasted plain text as Markdown', async () => {
    const { editor } = await renderEditor()

    const handled = editor.view.pasteHTML(
      '<pre>ignored</pre>',
      pasteEvent({
        'text/plain': '## Pasted\n\n- item with **weight**',
        'text/html': '<pre>## Pasted\n\n- item with **weight**</pre>',
      }),
    )

    expect(handled).toBe(true)
    const types = (editor.getJSON().content ?? []).map((node) => node.type)
    expect(types).toContain('heading')
    expect(types).toContain('bulletList')
    expect(types).not.toContain('codeBlock')
    expect(editor.getMarkdown()).toContain('- item with **weight**')
  })

  it('turns a pasted URL over selected text into a link', async () => {
    const { editor } = await renderEditor()
    typeText(editor, 'read this')
    editor.commands.setTextSelection({ from: 6, to: 10 })

    editor.view.pasteText(
      'https://example.com/this',
      pasteEvent({ 'text/plain': 'https://example.com/this' }),
    )

    expect(editor.getMarkdown()).toContain(
      'read [this](https://example.com/this)',
    )
  })

  it('keeps structure for content copied from another Garden editor', async () => {
    const source = await renderEditor({
      defaultValue: '- copied item\n- second item',
    })
    const { dom } = source.editor.view.serializeForClipboard(
      source.editor.state.doc.slice(0, source.editor.state.doc.content.size),
    )
    const html = dom.innerHTML
    expect(html).toContain('data-pm-slice')
    cleanup()

    const target = await renderEditor()
    target.editor.view.pasteHTML(
      html,
      pasteEvent({
        'text/plain': 'copied item\nsecond item',
        'text/html': html,
      }),
    )

    expect(target.editor.getMarkdown()).toContain(
      '- copied item\n- second item',
    )
  })

  it('drops unknown attributes from the slice context of pasted HTML', async () => {
    const { editor } = await renderEditor()
    const context = JSON.stringify([
      'blockquote',
      { onclick: 'globalThis.__gardenPaste = 1', class: 'injected' },
    ])
    const html = `<p data-pm-slice="1 1 ${context.replace(/"/g, '&quot;')}">quoted text</p>`

    editor.view.pasteHTML(
      html,
      pasteEvent({ 'text/plain': 'quoted text', 'text/html': html }),
    )

    const rendered = editor.view.dom.innerHTML
    expect(editor.getText()).toContain('quoted text')
    expect(rendered).not.toContain('onclick')
    expect(rendered).not.toContain('injected')
    expect(editor.getJSON().content?.[0]?.attrs ?? {}).not.toHaveProperty(
      'onclick',
    )
  })
})

describe('installed ProseMirror View slice context validation', () => {
  /**
   * Garden's node attributes declare no validators. This test editor adds one
   * validator to StarterKit's blockquote and pastes HTML that names the
   * blockquote only in `data-pm-slice`. ProseMirror View before 1.42.3 did
   * not validate those context attributes.
   */
  const ToneAttribute = Extension.create({
    name: 'toneAttributeTest',
    addGlobalAttributes() {
      return [
        {
          types: ['blockquote'],
          attributes: {
            tone: {
              default: 'plain',
              validate: (value: unknown) => {
                if (value !== 'plain' && value !== 'note')
                  throw new RangeError('invalid tone')
              },
            },
          },
        },
      ]
    },
  })

  function pasteWithTone(tone: unknown) {
    const element = document.createElement('div')
    const editor = new CoreEditor({
      element,
      extensions: [StarterKit, ToneAttribute],
    })
    const context = JSON.stringify(['blockquote', { tone }])
    const html = `<p data-pm-slice="1 1 ${context.replace(/"/g, '&quot;')}">quoted text</p>`
    editor.view.pasteHTML(
      html,
      pasteEvent({ 'text/plain': 'quoted text', 'text/html': html }),
    )
    const json = editor.getJSON()
    editor.destroy()
    return json.content ?? []
  }

  it('keeps a wrapper whose context attributes are valid', () => {
    expect(pasteWithTone('note')[0]).toEqual(
      expect.objectContaining({ type: 'blockquote', attrs: { tone: 'note' } }),
    )
  })

  it('refuses a wrapper whose context attributes fail validation', () => {
    const content = pasteWithTone('<img src=x onerror=alert(1)>')
    expect(content.map((node) => node.type)).not.toContain('blockquote')
    expect(JSON.stringify(content)).not.toContain('onerror')
    expect(JSON.stringify(content)).toContain('quoted text')
  })
})

describe('installed @tiptap/core Markdown and attribute helpers', () => {
  it('parses long inline shortcode attributes in linear time', () => {
    const tokenizer = createInlineMarkdownSpec({
      nodeName: 'probe',
      selfClosing: true,
    }).markdownTokenizer
    const attack = `[probe ${'0'.repeat(65_536)}]`
    const control = `[probe ${'-'.repeat(65_536)}]`

    const attackMs = elapsedMs(() =>
      tokenizer?.tokenize(attack, [], {} as never),
    )
    const controlMs = elapsedMs(() =>
      tokenizer?.tokenize(control, [], {} as never),
    )

    // The advisory measured 2.2 seconds at half this length on 3.29.2.
    expect(attackMs).toBeLessThan(250 + controlMs * 20)
  })

  it('parses long block attributes in linear time', () => {
    const tokenizer = createAtomBlockMarkdownSpec({
      nodeName: 'probe',
    }).markdownTokenizer
    const attack = `:::probe {${'__QUOTED_0'.repeat(4096)}__QUOTED_0__} :::\n`

    // The advisory measured 1.4 seconds at half this length on 3.29.2.
    expect(
      elapsedMs(() => tokenizer?.tokenize(attack, [], {} as never)),
    ).toBeLessThan(250)
  })

  it('reads long Markdown in the Garden editor in linear time', async () => {
    const { editor } = await renderEditor()
    const source = `[@ ${'0'.repeat(65_536)}]`

    const ms = elapsedMs(() => {
      editor.commands.setContent(source, { contentType: 'markdown' })
    })

    expect(ms).toBeLessThan(1_000)
    expect(editor.getText()).toContain('000')
  })

  it('does not take a prototype from an own __proto__ key', () => {
    const input = JSON.parse(
      '{"__proto__": {"src": "x-invalid://canary", "onerror": "globalThis.__tiptapXss = 1"}}',
    ) as Record<string, unknown>

    const attrs = mergeAttributes({ class: 'mention' }, input)

    expect(Object.getPrototypeOf(attrs)).toBe(Object.prototype)
    expect('onerror' in attrs).toBe(false)

    const schema = new Schema({
      nodes: {
        doc: { content: 'image' },
        image: { toDOM: () => ['img', attrs] },
        text: {},
      },
    })
    const fragment = DOMSerializer.fromSchema(schema).serializeFragment(
      schema.node('doc', null, [schema.node('image')]).content,
    )
    const img = fragment.firstChild as HTMLElement
    expect(img.hasAttribute('onerror')).toBe(false)
    expect(img.hasAttribute('src')).toBe(false)
  })
})
