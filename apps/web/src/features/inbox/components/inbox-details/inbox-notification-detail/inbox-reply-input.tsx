import { useCallback, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import {
  ArrowUp,
  Bold,
  ChevronDown,
  Code2,
  Heading,
  Highlighter,
  Italic,
  Mic,
  Plus,
  SlidersHorizontal,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  Underline,
  X,
} from 'lucide-react'
import { cn } from '@garden/ui/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@garden/ui/components/ui/dropdown-menu'

type SpeechRecognitionEvent = Event & {
  resultIndex: number
  results: {
    length: number
    [index: number]: {
      isFinal: boolean
      [index: number]: { transcript: string }
    }
  }
}

type BrowserSpeechRecognition = EventTarget & {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onend: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  onresult: ((event: SpeechRecognitionEvent) => void) | null
}

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => BrowserSpeechRecognition
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition
}

const HarnessyIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 18 23.995"
    fill="none"
    className={className}
  >
    <path
      d="M5.7841796875,12.638671875L11.5703125,18.31640625L5.7841796875,23.9951171875L0,18.31640625L5.7841796875,12.638671875ZM12.21435546875,6.32421875L18,12.00390625L12.21435546875,17.681640625L6.4296875,12.001953125L12.21435546875,6.32421875ZM5.7841796875,0L11.5703125,5.6796875L5.7841796875,11.357421875L0,5.677734375L5.7841796875,0Z"
      fill="#772CE8"
    />
  </svg>
)

type EditorCommand =
  | 'highlight'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'formatBlock'
  | 'justifyLeft'
  | 'justifyCenter'
  | 'justifyRight'
  | 'justifyFull'

type ToolbarItem = {
  command: EditorCommand
  icon: ComponentType<{ className?: string }>
  label: string
  value?: string
}

const toolbarGroups: ToolbarItem[][] = [
  [
    { command: 'highlight', icon: Highlighter, label: 'Highlight' },
    { command: 'underline', icon: Underline, label: 'Underline' },
    { command: 'formatBlock', icon: Code2, label: 'Code block', value: 'pre' },
  ],
  [
    { command: 'bold', icon: Bold, label: 'Bold' },
    { command: 'italic', icon: Italic, label: 'Italic' },
    { command: 'formatBlock', icon: Heading, label: 'Heading', value: 'h3' },
  ],
  [
    { command: 'justifyCenter', icon: TextAlignCenter, label: 'Align center' },
    { command: 'justifyLeft', icon: TextAlignStart, label: 'Align left' },
    { command: 'justifyRight', icon: TextAlignEnd, label: 'Align right' },
    { command: 'justifyFull', icon: TextAlignJustify, label: 'Justify' },
  ],
]

const models = [
  { id: 'harnessy', label: 'Harnessy', Icon: HarnessyIcon },
  { id: 'harnessy-pro', label: 'Harnessy Pro', Icon: HarnessyIcon },
  { id: 'harnessy-fast', label: 'Harnessy Fast', Icon: HarnessyIcon },
] as const

export type ModelId = (typeof models)[number]['id']

type ModelOption<T extends string> = {
  id: T
  label: string
  Icon: ComponentType<{ className?: string }>
}

/**
 * Built on DropdownMenu so it works from the keyboard (arrow keys, Escape,
 * focus returned to the trigger). The hand-built listbox it replaces could
 * only be used with a mouse.
 */
function ModelPicker<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (id: T) => void
  options: readonly ModelOption<T>[]
}) {
  const current = options.find((m) => m.id === value) ?? options[0]!

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Model: ${current.label}`}
        className="group inline-flex h-8 cursor-pointer items-center gap-2 rounded-full bg-muted px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent"
      >
        <current.Icon className="h-4 w-auto" />
        {/* Hide the label on very narrow screens; the icon alone identifies
            the current model. Restores from `sm` up. */}
        <span className="hidden max-w-24 truncate sm:inline">
          {current.label}
        </span>
        <ChevronDown className="size-3.5 transition-transform group-data-[popup-open]:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="min-w-45">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as T)}
        >
          {options.map(({ id, label, Icon }) => (
            <DropdownMenuRadioItem key={id} value={id} className="text-xs">
              <Icon className="h-4 w-auto" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Animated voice */
function ListeningIndicator({ elapsed }: { elapsed: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="relative inline-flex size-2.5 shrink-0">
        <span className="absolute inset-0 animate-ping rounded-full bg-red-500/70" />
        <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
      </span>

      <div
        className="flex h-6 items-end gap-0.5"
        role="status"
        aria-live="polite"
        aria-label="Listening"
      >
        {Array.from({ length: 12 }).map((_, i) => (
          <span
            key={i}
            className="voice-bar w-0.75 rounded-full bg-brand/80"
            style={{ animationDelay: `${i * 90}ms` }}
          />
        ))}
      </div>

      <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
        {String(Math.floor(elapsed / 60)).padStart(2, '0')}:
        {String(elapsed % 60).padStart(2, '0')}
      </span>
    </div>
  )
}

export function InboxReplyInput({
  onSubmit,
  submitting = false,
}: {
  onSubmit: (content: string) => Promise<boolean>
  submitting?: boolean
}) {
  const [model, setModel] = useState<ModelId>('harnessy')
  const [activeTools, setActiveTools] = useState<string[]>([])
  const [hasContent, setHasContent] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null)
  const editorRef = useRef<HTMLDivElement | null>(null)
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const baselineTextRef = useRef('')
  const timerRef = useRef<number | null>(null)

  const focusEditor = () => {
    editorRef.current?.focus()
  }

  const updateContentState = () => {
    const text = editorRef.current?.textContent?.trim() ?? ''
    setHasContent(text.length > 0)
  }

  /** Starts the voice timer when speech recognition begins. */
  const startElapsedTimer = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    setElapsed(0)
    timerRef.current = window.setInterval(() => setElapsed((v) => v + 1), 1000)
  }

  /** Stops the voice timer when recognition ends or the editor unmounts. */
  const stopElapsedTimer = () => {
    if (timerRef.current === null) return
    window.clearInterval(timerRef.current)
    timerRef.current = null
  }

  const toolKey = (command: EditorCommand, value?: string) =>
    `${command}:${value ?? ''}`

  const setToolSelected = (
    command: EditorCommand,
    value: string | undefined,
    selected: boolean,
  ) => {
    const key = toolKey(command, value)
    setActiveTools((current) => {
      const withoutAlignment = command.startsWith('justify')
        ? current.filter((item) => !item.startsWith('justify'))
        : current
      const next = withoutAlignment.filter((item) => item !== key)
      return selected ? [...next, key] : next
    })
  }

  const highlightSelection = () => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return false
    }

    const range = selection.getRangeAt(0)
    const span = document.createElement('span')
    span.style.backgroundColor = 'var(--background-warning-default)'
    span.appendChild(range.extractContents())
    range.insertNode(span)
    selection.removeAllRanges()
    selection.selectAllChildren(span)
    return true
  }

  const runEditorCommand = (command: EditorCommand, value?: string) => {
    focusEditor()
    if (command === 'highlight') {
      const didHighlight = highlightSelection()
      setToolSelected(command, value, didHighlight)
      updateContentState()
      return
    }

    document.execCommand(command, false, value)
    const key = toolKey(command, value)
    const alignmentCommand = command.startsWith('justify')
    setActiveTools((current) => {
      const withoutAlignment = alignmentCommand
        ? current.filter((item) => !item.startsWith('justify'))
        : current
      if (alignmentCommand) return [...withoutAlignment, key]
      return withoutAlignment.includes(key)
        ? withoutAlignment.filter((item) => item !== key)
        : [...withoutAlignment, key]
    })
    updateContentState()
  }

  /** Replaces the editor content with the given text (used for voice). */
  const setEditorText = (text: string) => {
    if (!editorRef.current) return
    editorRef.current.textContent = text
    updateContentState()
  }

  /** Appends a spoken chunk to the baseline captured when listening started. */
  const appendTranscript = (chunk: string) => {
    const base = baselineTextRef.current
    const merged = base ? `${base} ${chunk}` : chunk
    setEditorText(merged)
  }

  const createRecognition = () => {
    const speechWindow = window as SpeechRecognitionWindow
    const SpeechRecognition =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition

    if (!SpeechRecognition) {
      setVoiceMessage('Voice input is not available in this browser.')
      return null
    }

    const recognition = new SpeechRecognition() as BrowserSpeechRecognition
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event) => {
      let interim = ''

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]!
        const transcript = result[0]?.transcript ?? ''
        if (result.isFinal) {
          appendTranscript(transcript.trim())
        } else {
          interim += transcript
        }
      }

      if (interim) {
        const base = baselineTextRef.current
        setEditorText(`${base ? `${base} ` : ''}${interim}`)
      }
    }

    recognition.onerror = () => {
      setIsListening(false)
      stopElapsedTimer()
      setVoiceMessage('Voice input stopped.')
    }

    recognition.onend = () => {
      setIsListening(false)
      stopElapsedTimer()
    }

    return recognition
  }

  const startListening = () => {
    const recognition = recognitionRef.current ?? createRecognition()
    if (!recognition) return
    recognitionRef.current = recognition
    baselineTextRef.current = editorRef.current?.textContent?.trim() ?? ''
    setVoiceMessage(null)
    setIsListening(true)
    startElapsedTimer()
    recognition.start()
  }

  const stopListening = () => {
    recognitionRef.current?.stop()
    setIsListening(false)
    stopElapsedTimer()
  }

  const cancelListening = () => {
    recognitionRef.current?.stop()
    setIsListening(false)
    stopElapsedTimer()
    setEditorText(baselineTextRef.current)
  }

  const cleanupVoiceInput = useCallback((node: HTMLDivElement | null) => {
    if (node) return
    recognitionRef.current?.stop()
    stopElapsedTimer()
  }, [])

  const handleSubmit = async () => {
    const content = editorRef.current?.textContent?.trim() ?? ''
    if (!content || submitting) return

    const sent = await onSubmit(content)
    if (!sent || !editorRef.current) return
    editorRef.current.textContent = ''
    setHasContent(false)
  }

  const toggleVoiceInput = () => {
    if (isListening) stopListening()
    else startListening()
  }

  return (
    <div
      ref={cleanupVoiceInput}
      className="rounded-2xl border border-border bg-background p-3 sm:rounded-[28px] sm:p-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-muted-foreground sm:gap-x-4">
        {toolbarGroups.map((group, groupIndex) => (
          <div
            key={groupIndex}
            className="flex shrink-0 items-center gap-2 sm:gap-4"
          >
            {groupIndex > 0 && (
              <span className="h-4 w-px bg-border" aria-hidden="true" />
            )}
            {group.map(({ command, icon: Icon, label, value }, index) => (
              <button
                key={`${command}-${value ?? index}`}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={activeTools.includes(toolKey(command, value))}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runEditorCommand(command, value)}
                className={cn(
                  'inline-flex size-6 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground',
                  activeTools.includes(toolKey(command, value)) &&
                    'bg-muted text-foreground',
                )}
              >
                <Icon className="size-3.5" />
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="relative mt-4 min-h-16">
        {!hasContent && (
          <div className="pointer-events-none absolute top-0 left-0 text-sm text-muted-foreground">
            Write your reply here...
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Reply body"
          onInput={updateContentState}
          onKeyUp={updateContentState}
          onMouseUp={updateContentState}
          className="rich-text-editor min-h-16 w-full text-sm text-foreground outline-none"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-y-3">
        <div className="flex items-center gap-3 text-xs font-medium text-foreground">
          <button
            type="button"
            aria-label="Add attachment"
            className="inline-flex size-5 items-center justify-center text-foreground transition-colors hover:text-muted-foreground"
          >
            <Plus className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Reply options"
            className="inline-flex size-5 items-center justify-center text-foreground transition-colors hover:text-muted-foreground"
          >
            <SlidersHorizontal className="size-4" />
          </button>
          <span className="hidden sm:inline">Default</span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isListening ? (
            <>
              <button
                type="button"
                aria-label="Cancel recording"
                title="Cancel"
                onClick={cancelListening}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </button>

              <ListeningIndicator elapsed={elapsed} />

              <button
                type="button"
                aria-label="Stop recording"
                title="Stop"
                onClick={stopListening}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-red-500 text-white transition-colors hover:bg-red-500/90"
              >
                <span className="block size-3 rounded-[3px] bg-white" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                aria-pressed={false}
                title="Start voice input"
                aria-label="Start voice input"
                onClick={toggleVoiceInput}
                className="inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
              >
                <Mic className="size-3.5" />
              </button>

              <ModelPicker value={model} onChange={setModel} options={models} />

              <button
                type="button"
                aria-label="Send reply"
                onClick={handleSubmit}
                disabled={!hasContent || submitting}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ArrowUp className="size-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {voiceMessage && (
        <p className="mt-2 text-xs text-muted-foreground">{voiceMessage}</p>
      )}
    </div>
  )
}
