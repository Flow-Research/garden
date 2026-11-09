import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const mockFocus = vi.hoisted(() => vi.fn())
type EditorHooks = {
  onUpdate?: (props: { editor: unknown }) => void
  onBlur?: () => void
}
const editorMock = vi.hoisted(() => ({
  markdown: '',
  options: {} as EditorHooks,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
}))

vi.mock('./extensions', () => ({
  createEditorExtensions: () => [],
}))

vi.mock('./extensions/file-upload', () => ({
  uploadAndInsertFile: vi.fn(),
}))

vi.mock('./utils/preprocess', () => ({
  preprocessMarkdown: (value: string) => value,
}))

vi.mock('./bubble-menu', () => ({
  EditorBubbleMenu: () => null,
}))

vi.mock('@tiptap/react', () => ({
  useEditor: (
    options: EditorHooks & { onCreate?: (props: { editor: unknown }) => void },
  ) => {
    const editor = {
      commands: { focus: mockFocus, clearContent: vi.fn() },
      getMarkdown: () => editorMock.markdown,
      state: { doc: { content: { size: 0 } }, selection: { empty: true } },
    }
    editorMock.options = options
    options.onCreate?.({ editor })
    return editor
  },
  EditorContent: ({ className }: { className?: string }) => (
    <div className={className} data-testid="editor-content">
      <div className="ProseMirror rich-text-editor" data-testid="prosemirror" />
    </div>
  ),
}))

import { NavigationProvider } from '../navigation'
import { ContentEditor } from './content-editor'

const navigation = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  pathname: '/',
  searchParams: new URLSearchParams(),
}

function renderEditor() {
  return render(
    <NavigationProvider value={navigation}>
      <ContentEditor placeholder="Add description..." />
    </NavigationProvider>,
  )
}

describe('ContentEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('focuses the editor when clicking the empty container area', () => {
    renderEditor()

    const shell = screen.getByTestId('editor-content').parentElement
    expect(shell).not.toBeNull()

    fireEvent.mouseDown(shell!)

    expect(mockFocus).toHaveBeenCalledWith('end')
  })

  it('does not hijack clicks that land inside the ProseMirror node', () => {
    renderEditor()

    fireEvent.mouseDown(screen.getByTestId('prosemirror'))

    expect(mockFocus).not.toHaveBeenCalled()
  })

  describe('debounced onUpdate', () => {
    function renderWithUpdate(onUpdate: (markdown: string) => void) {
      return render(
        <NavigationProvider value={navigation}>
          <ContentEditor onUpdate={onUpdate} debounceMs={1500} />
        </NavigationProvider>,
      )
    }

    function type(markdown: string) {
      editorMock.markdown = markdown
      editorMock.options.onUpdate?.({
        editor: { getMarkdown: () => editorMock.markdown },
      })
    }

    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('saves an edit still inside the debounce window on unmount', () => {
      const onUpdate = vi.fn()
      const { unmount } = renderWithUpdate(onUpdate)

      type('last words')
      unmount()

      expect(onUpdate).toHaveBeenCalledTimes(1)
      expect(onUpdate).toHaveBeenCalledWith('last words')
    })

    it('saves a pending edit as soon as the editor loses focus', () => {
      const onUpdate = vi.fn()
      renderWithUpdate(onUpdate)

      type('typed then tabbed away')
      editorMock.options.onBlur?.()

      expect(onUpdate).toHaveBeenCalledWith('typed then tabbed away')
    })

    it('saves once after the debounce and not again on unmount', () => {
      const onUpdate = vi.fn()
      const { unmount } = renderWithUpdate(onUpdate)

      type('settled')
      vi.advanceTimersByTime(1500)
      unmount()

      expect(onUpdate).toHaveBeenCalledTimes(1)
    })
  })
})
