import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const mockFocus = vi.hoisted(() => vi.fn())

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
  useEditor: () => ({
    commands: {
      focus: mockFocus,
      clearContent: vi.fn(),
    },
    getMarkdown: () => '',
    state: {
      doc: {
        content: {
          size: 0,
        },
      },
      selection: {
        empty: true,
      },
    },
  }),
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
})
