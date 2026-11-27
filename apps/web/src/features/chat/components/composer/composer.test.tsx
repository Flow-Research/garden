import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * These tests drive the real field. The Tiptap-era version of this file had to
 * mock `ComposerEditor` and fake a submit button, because there is no way to
 * type into a ProseMirror view under jsdom — which meant the send-gate logic
 * was exercised against a stand-in rather than the thing that ships. With the
 * composer back on a `<textarea>` (2026-09-17 review), `userEvent.type` drives
 * the same code path a person does.
 */
vi.mock('@garden/app-state/hooks', () => ({
  useWorkspaceId: () => 'ws-1',
  useWorkspaceStore: () => null,
}))
// `queryOptions` is tanstack's identity-shaped helper (it just returns its
// argument with the right typing) — `memberListOptions`/`agentSkillListOptions`
// call it directly, so the mock passes it through and then answers each query
// off its real key. Keying on the query (rather than returning one blob) is
// what lets the `@` test seed members without also handing the same rows to the
// skills query.
const MEMBERS = vi.hoisted(
  () => [] as { user_id: string; name: string; email: string }[],
)
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: readonly unknown[] }) => ({
    data: options.queryKey.includes('members') ? MEMBERS : [],
    isFetching: false,
    isError: false,
  }),
  queryOptions: (options: unknown) => options,
}))

import { Composer } from './composer'

const base = {
  agentId: 'a1',
  documents: [],
  isStreaming: false,
  status: 'ready' as const,
  input: '',
  onInputChange: vi.fn(),
  onSend: vi.fn().mockResolvedValue(undefined),
  onStop: vi.fn(),
}

/**
 * The field is controlled by the `input` prop, so a test that types has to feed
 * the change back the way the real controller does (a chat-store draft write
 * that re-renders) — otherwise the value never moves and every assertion about
 * "has content" is vacuous.
 */
function ControlledComposer({
  onInputChange,
  ...props
}: Omit<React.ComponentProps<typeof Composer>, 'input'>) {
  const [value, setValue] = useState('')
  return (
    <Composer
      {...props}
      input={value}
      onInputChange={(next) => {
        setValue(next)
        onInputChange(next)
      }}
    />
  )
}

function renderControlled(overrides: Partial<typeof base> = {}) {
  const onSend = overrides.onSend ?? vi.fn().mockResolvedValue(undefined)
  const view = render(
    <ControlledComposer {...base} {...overrides} onSend={onSend} />,
  )
  return { ...view, onSend }
}

function field() {
  return screen.getByTestId('composer-input') as HTMLTextAreaElement
}

describe('Composer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MEMBERS.length = 0
  })

  it('sends what was typed', async () => {
    const { onSend } = renderControlled()
    await userEvent.type(field(), 'hello there')
    await userEvent.click(screen.getByRole('button', { name: /send message/i }))
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'hello there',
        files: [],
        selectedDocuments: [],
      }),
    )
  })

  it('sends on Enter and inserts a newline on Shift+Enter', async () => {
    const { onSend } = renderControlled()
    await userEvent.type(field(), 'first{Shift>}{Enter}{/Shift}second')
    expect(field().value).toBe('first\nsecond')
    expect(onSend).not.toHaveBeenCalled()

    await userEvent.type(field(), '{Enter}')
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'first\nsecond' }),
    )
  })

  it('does not send when empty', async () => {
    const { onSend } = renderControlled()
    await userEvent.type(field(), '   ')
    await userEvent.type(field(), '{Enter}')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('renders the empty submit button with disabled tokens', () => {
    render(<Composer {...base} />)

    const submit = screen.getByRole('button', { name: /send message/i })
    expect(submit).toBeDisabled()
    expect(submit).toHaveClass(
      'bg-background-disabled-default',
      'text-icon-disabled',
    )
  })

  it('shows Stop while streaming', () => {
    render(<Composer {...base} isStreaming />)
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument()
  })

  /**
   * The formatting toolbar, the `Sources` control and the agent selector were
   * all removed in the 2026-09-17 review — the first because rich text has no
   * meaning in a message to a model, the other two because they were no-ops.
   */
  it('renders no formatting toolbar, sources control or agent selector', () => {
    render(<Composer {...base} />)
    expect(
      screen.queryByRole('button', { name: /bold/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /sources/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/connect your apps/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/use a folder/i)).not.toBeInTheDocument()
  })

  it('attaches a file, renders a chip, removes it, and sends the remaining attachment', async () => {
    const { onSend } = renderControlled()
    const fileA = new File(['a'], 'notes.txt', { type: 'text/plain' })
    const fileB = new File(['b'], 'plan.txt', { type: 'text/plain' })
    const input = screen.getByTestId('composer-file-input') as HTMLInputElement

    await userEvent.upload(input, fileA)
    expect(await screen.findByText('notes.txt')).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: /remove notes\.txt/i }),
    )
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument()

    await userEvent.upload(input, fileB)
    expect(await screen.findByText('plan.txt')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /send message/i }))
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ files: [fileB] }),
    )
  })

  it('keeps the drop overlay up across a nested drag and hides it only after the matching leave', () => {
    render(<Composer {...base} />)
    const pill = screen.getByTestId('composer-pill')
    const dataTransfer = { types: ['Files'] }

    fireEvent.dragEnter(pill, { dataTransfer })
    fireEvent.dragEnter(pill, { dataTransfer })
    expect(screen.getByText(/drop to attach/i)).toBeInTheDocument()

    fireEvent.dragLeave(pill, { dataTransfer })
    expect(screen.getByText(/drop to attach/i)).toBeInTheDocument()

    fireEvent.dragLeave(pill, { dataTransfer })
    expect(screen.queryByText(/drop to attach/i)).not.toBeInTheDocument()
  })

  it('attaches a pasted file', () => {
    render(<Composer {...base} />)
    const pill = screen.getByTestId('composer-pill')
    const file = new File(['x'], 'clip.png', { type: 'image/png' })
    fireEvent.paste(pill, {
      clipboardData: { files: [file], types: ['Files'] },
    })
    expect(screen.getByTitle('clip.png')).toBeInTheDocument()
  })

  it('clears the draft and attachments on a successful send', async () => {
    const onInputChange = vi.fn()
    const { onSend } = renderControlled({ onInputChange })

    await userEvent.type(field(), 'hello')
    const file = new File(['a'], 'a.txt', { type: 'text/plain' })
    await userEvent.upload(
      screen.getByTestId('composer-file-input') as HTMLInputElement,
      file,
    )
    await userEvent.click(screen.getByRole('button', { name: /send message/i }))

    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'hello',
        files: [file],
        selectedDocuments: [],
      }),
    )
    expect(onInputChange).toHaveBeenLastCalledWith('')
    expect(field().value).toBe('')
    expect(screen.queryByText('a.txt')).not.toBeInTheDocument()
  })

  /**
   * Click-to-focus on the composer pill.
   *
   * The pill reads as a single input field, so a press anywhere in its chrome —
   * the gaps `flex-col gap-3` opens between the field and the footer, the
   * footer's own row — must put the caret in the field. The guard this replaced
   * was an `onClick` with `event.target === event.currentTarget`, which rejected
   * every one of those spots because they are all descendants.
   *
   * Mousedown, not click: focus and text selection both happen on mousedown, so
   * `handlePillMouseDown` has to run (and `preventDefault`) before them.
   */
  it('focuses the field when the pill chrome is pressed', () => {
    render(<Composer {...base} />)
    const pill = screen.getByTestId('composer-pill')
    // A DESCENDANT, not the pill itself: the footer's row wrapper is one of the
    // dead zones the old `target === currentTarget` guard rejected, so pressing
    // the pill element directly would not have caught the bug.
    const footerRow = pill.lastElementChild as HTMLElement
    expect(footerRow.tagName).toBe('DIV')
    fireEvent.mouseDown(footerRow)
    expect(document.activeElement).toBe(field())
  })

  /**
   * The counterpart guard: real controls keep their own focus and activation.
   * Without the interactive-element check the handler would yank focus out of
   * every button in the footer on press, breaking the menus it opens.
   */
  it('leaves focus alone when a control inside the pill is pressed', () => {
    render(<Composer {...base} />)
    fireEvent.mouseDown(screen.getByRole('button', { name: /add files/i }))
    expect(document.activeElement).not.toBe(field())
  })

  /**
   * The `@` popup and its serialization are the July 2026 `member-mention.ts`
   * work (cache-backed lookup, identity preservation, collapsed-deletion
   * rebasing) that the Tiptap pass deleted along with its 176-line test file.
   * This covers the composer's half of it: the live member list reaches the
   * popup, a pick writes `@Name` into the field, and submit commits it as a
   * mention link rather than as the literal text.
   */
  it('offers members on @ and commits the pick as a mention link', async () => {
    MEMBERS.push({
      user_id: 'user-1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    })
    const { onSend } = renderControlled()

    await userEvent.type(field(), 'ping @ada')
    await userEvent.click(await screen.findByText('@Ada Lovelace'))

    expect(field().value).toBe('ping @Ada Lovelace ')

    await userEvent.click(screen.getByRole('button', { name: /send message/i }))
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'ping [@Ada Lovelace](mention://member/user-1)',
      }),
    )
  })

  /**
   * Escape closes the popup, and typing the next character brings it back.
   * The dismissal is keyed to the draft the person pressed Escape on rather
   * than held as a boolean that an effect resets, so this also guards that the
   * key still changes on the next keystroke.
   */
  it('dismisses the @ popup on Escape and reopens it on the next keystroke', async () => {
    MEMBERS.push({
      user_id: 'user-1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    })
    renderControlled()

    await userEvent.type(field(), '@ad')
    expect(await screen.findByText('@Ada Lovelace')).toBeInTheDocument()

    await userEvent.type(field(), '{Escape}')
    expect(screen.queryByText('@Ada Lovelace')).not.toBeInTheDocument()

    await userEvent.type(field(), 'a')
    expect(await screen.findByText('@Ada Lovelace')).toBeInTheDocument()
  })
})
