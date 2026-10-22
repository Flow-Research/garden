/**
 * `Composer` — orchestrator for the chat input box.
 *
 * Field type: a plain controlled `<textarea>`, not a rich-text editor.
 *
 * The 2026-09-08 overhaul briefly moved this onto the shared Tiptap
 * `ContentEditor`. The 2026-09-17 review reverted that: bold/italic/headings/
 * alignment have no meaning in a message to a model, and the editor charged
 * for them on every keystroke. Measured against the installed `@tiptap/react`
 * 3.22.4 and `@tiptap/core` 3.22.4, each character typed serialized the whole
 * document to markdown, rebuilt ~20 extension instances (`ContentEditor`
 * builds them inline, and `EditorInstanceManager.onRender` compares them by
 * identity, so the compare always missed), and pushed a full
 * `view.setProps` + `view.updateState` through ProseMirror. The composer is
 * also `key={sessionId}` in the controller, so every session switch tore down
 * and rebuilt an editor, extension manager and view. A textarea costs one
 * store write per keystroke and near-zero mount.
 *
 * The overhaul's other work is kept as-is: the pill, the queued-message slot,
 * the attachment/document chip rows, the `+` and tools menus, and the
 * send/stop/mic footer.
 *
 * `@` and `/` are back on `./member-mention.ts` + `../skill-invocation.ts`
 * cursor detection with `<Command>` popovers. `member-mention.ts` was hardened
 * for this box in July 2026 (4c69e772, f86dc2aa, d3f6d33d, fda427e2:
 * cache-backed lookup, identity preservation, collapsed-deletion rebasing) and
 * the Tiptap pass had deleted it wholesale. Both popovers read live query
 * state on every render, which is also what fixes the cold-load `/` bug the
 * editor's suggestion extension had: it captured the skill list once at
 * creation and never saw the resolved query.
 *
 * `/slug` tokens stay literal text in the committed message (2026-09-08 spec
 * §12); `@` mentions are serialized to mention links at submit.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowUp,
  FileText,
  Loader2,
  Mic,
  Paperclip,
  StopCircle,
  X,
} from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@garden/ui/components/ui/command'
import { Textarea } from '@garden/ui/components/ui/textarea'
import { cn } from '@garden/ui/lib/utils'
import { SpeechInput } from '@/components/ai-elements/speech-input'
import {
  agentSkillListOptions,
  memberListOptions,
} from '@/lib/workspace/queries'
import { useWorkspaceId } from '@garden/app-state/hooks'
import type {
  StructuredQuestion,
  StructuredQuestionAnswers,
} from '@garden/app-state/chat'
import {
  type ComposerSkill,
  type RealtimeStatus,
} from '../../chat-runtime-provider'
import { ActorAvatar } from '../../../common/actor-avatar'
import { detectSkillTrigger, formatSkillInvocation } from '../skill-invocation'
import { searchComposerSkills } from '../skill-search'
import {
  deserializeMemberMentions,
  detectMemberMentionTrigger,
  isMemberMentionSelectionKey,
  rebaseMemberMentions,
  resolveMemberMentionTextEdit,
  searchComposerMembers,
  serializeMemberMentions,
  type SelectedMemberMention,
} from '../member-mention'
import { StructuredInputPanel } from '../structured-input-panel'
import type { SelectedThreadDocument } from '../document-selection'
import {
  FileKindIcon,
  getFileKind,
  getFileKindLabel,
} from '../chat-document-panel'
import {
  ACCEPTED_FILE_TYPES,
  COMPOSER_WIDTH_CLASS_NAME,
  SkillGlyph,
  normalizeStatus,
  type ComposerThreadDocument,
  type PreviewAttachment,
} from './composer-helpers'
import { ComposerAddMenu } from './composer-add-menu'
import { ComposerToolsMenu } from './composer-tools-menu'
import { DEFAULT_TOOL_PRESET_ID, type ToolPresetId } from './composer-tools'

/** Tallest the field grows before it starts scrolling its own overflow. */
const TEXTAREA_MAX_HEIGHT = 200
/** Resting height of the empty single-line field. */
const TEXTAREA_MIN_HEIGHT = 28

/**
 * Imperative handle exposed by `Composer`.
 *
 * Only the two things a parent genuinely cannot do through props live here.
 * The draft text is not one of them any more: the field is controlled by
 * `input`/`onInputChange`, so pushing text in is just a store write (this is
 * why the Tiptap-era `setDraft` escape hatch is gone).
 */
export interface ComposerHandle {
  /**
   * Put a queued send back into the composer so it can be edited before it
   * goes out (2026-09-16 message-queue design, the pencil action on a queue
   * row). Restores the whole payload, not just the prose: a queued message can
   * carry attachments and selected thread documents, and dropping those on the
   * way back would quietly change what the person is about to send.
   *
   * `text` arrives as the message was committed — mentions already serialized
   * — so it is decoded back into `@Label` text plus live mention ranges here.
   * Without that the person would be handed raw `[@Ada](mention://member/…)`
   * to edit.
   */
  restoreDraft: (payload: {
    text: string
    files: File[]
    selectedDocumentIds: string[]
  }) => void
  /** Puts the caret in the field, e.g. after a suggestion pill prefills it. */
  focus: () => void
}

export interface ComposerProps {
  agentId: string
  documents: ComposerThreadDocument[]
  isStreaming: boolean
  status: RealtimeStatus
  input: string
  onInputChange: (value: string) => void
  onSend: (payload: {
    text: string
    files: File[]
    selectedDocuments: SelectedThreadDocument[]
  }) => Promise<void>
  onStop: () => void
  onWarmRuntime?: () => void
  pendingQuestions?: StructuredQuestion[]
  onSubmitAnswers?: (answers: StructuredQuestionAnswers) => void
  /**
   * Slot rendered directly above the pill, inside its width wrapper — the
   * queued-message slab (`../chat-message-queue.tsx`, 2026-09-16 design).
   *
   * A slot rather than a `queuedMessages` prop: the queue's contents, ordering
   * and actions belong to the controller that owns the send pipeline, and the
   * composer only needs to know where the thing goes. It has to be here and
   * not in the controller's own markup because the slab tucks behind the pill,
   * which needs the two to be siblings under the same
   * `COMPOSER_WIDTH_CLASS_NAME` wrapper.
   */
  queue?: ReactNode
}

/**
 * `ComposerFooter` — bottom row of the composer pill: left cluster (`+`
 * attachment menu, tools menu), right cluster (mic, send/stop).
 *
 * The `Sources` control and the agent selector used to sit here too. Both were
 * removed in the 2026-09-17 review: neither did anything (sources rendered a
 * static stub list, the agent select only wrote a store field nothing in chat
 * reads back), and both re-sorted/re-filtered their lists on every render of a
 * component that re-renders on every keystroke.
 *
 * The send/stop button's `isStreaming` / `isSubmitted` /
 * `hasStaleDocumentSelection` / `hasContent` branching is deliberately not
 * collapsed into a single enum: the armed styling and the disabled attribute
 * vary independently (a stale document selection disables the button without
 * suppressing the armed fill).
 */
function ComposerFooter(props: {
  addMenu: ReactNode
  toolsMenu: ReactNode
  onMicTranscription: (value: string) => void
  isStreaming: boolean
  hasContent: boolean
  isSubmitted: boolean
  hasStaleDocumentSelection: boolean
  onSend: () => void
  onStop: () => void
}) {
  const {
    addMenu,
    toolsMenu,
    onMicTranscription,
    isStreaming,
    hasContent,
    isSubmitted,
    hasStaleDocumentSelection,
    onSend,
    onStop,
  } = props

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center">
        {addMenu}
        {toolsMenu}
      </div>
      <div className="flex items-center gap-2">
        {/*
          Rendered only while there is nothing to send — 2026-09-08 spec §8.2
          ("shown when the editor is empty").

          Deliberately passes NO `disabled` prop. SpeechInput destructures only
          className / onTranscriptionChange / onAudioRecorded / lang, so a
          `disabled` we pass falls into `...props` and is spread onto its inner
          <Button> AFTER that button's own `disabled={isDisabled}` — the
          caller's value wins and silently defeats the component's readiness
          gate. That gate covers mode === 'none', media-recorder without
          onAudioRecorded, and isProcessing, so overriding it renders the mic
          clickable-but-inert on Safari/Firefox and unsupported browsers.
          Let SpeechInput gate itself.
        */}
        {!isStreaming && !hasContent ? (
          <SpeechInput
            variant="ghost"
            size="icon"
            className="size-8 rounded-sm text-icon-default"
            onTranscriptionChange={onMicTranscription}
          >
            <Mic className="size-4" />
          </SpeechInput>
        ) : null}
        {/*
          Stop and send are no longer mutually exclusive. They were before the
          2026-09-16 message-queue design, which meant a turn in flight hid the
          send button and left mid-reply typing with nowhere to go. Now the
          stop button stays for the whole turn — interrupting is never taken
          away — and the send button joins it as soon as there is something to
          send, queueing that payload behind the running reply.
        */}
        {isStreaming ? (
          <Button
            type="button"
            className="size-8 rounded-xl bg-background-danger-default text-text-danger-on-danger transition-all duration-150 hover:scale-105 hover:bg-background-danger-default-hover"
            onClick={onStop}
            aria-label="Stop generation"
          >
            <StopCircle className="size-4" />
          </Button>
        ) : null}
        {isStreaming && !hasContent ? null : (
          <Button
            type="button"
            className={cn(
              'size-8 rounded-xl transition-all duration-150 hover:scale-105 disabled:opacity-100 disabled:hover:scale-100',
              hasContent
                ? 'bg-background-brand-secondary text-icon-brand-default hover:bg-background-brand-secondary-hover'
                : 'bg-background-disabled-default text-icon-disabled',
            )}
            onClick={onSend}
            disabled={isSubmitted || hasStaleDocumentSelection || !hasContent}
            aria-label={
              isSubmitted
                ? 'Sending'
                : isStreaming
                  ? 'Queue message'
                  : 'Send message'
            }
          >
            {isSubmitted ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowUp className="size-4" />
            )}
          </Button>
        )}
      </div>
    </div>
  )
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(
  function Composer(
    {
      agentId,
      documents,
      isStreaming,
      status,
      input,
      onInputChange,
      onSend,
      onStop,
      onWarmRuntime,
      pendingQuestions,
      onSubmitAnswers,
      queue,
    },
    ref,
  ) {
    const [attachments, setAttachments] = useState<PreviewAttachment[]>([])
    const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([])
    const fileInputRef = useRef<HTMLInputElement | null>(null)
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const workspaceId = useWorkspaceId()

    /**
     * Metadata from `beforeinput`, consumed by the next `change`. The browser
     * reports the exact replaced range and the edit's `inputType` only on the
     * former, and `rebaseMemberMentions` needs both to tell a backward delete
     * from a forward one — diffing the two strings alone cannot, because a
     * collapsed deletion looks identical from either side.
     */
    const pendingTextEditRef = useRef<{
      selectionStart: number
      selectionEnd: number
      inputType: string
    } | null>(null)
    const [cursor, setCursor] = useState(() => input.length)
    const [selectedMemberMentions, setSelectedMemberMentions] = useState<
      SelectedMemberMention[]
    >([])

    const [toolPreset, setToolPreset] = useState<ToolPresetId>(
      DEFAULT_TOOL_PRESET_ID,
    )

    const selectedDocuments = useMemo(
      () =>
        selectedDocumentIds.flatMap((documentId) => {
          const document = documents.find(
            (candidate) => candidate.documentId === documentId,
          )
          return document ? [document] : []
        }),
      [documents, selectedDocumentIds],
    )
    const hasStaleDocumentSelection =
      selectedDocuments.length !== selectedDocumentIds.length

    // Drag depth counter — dragenter/dragleave fire for child elements too,
    // so nested entries/exits must be counted to know when the pointer has
    // actually left the drop zone.
    const dragDepthRef = useRef(0)
    const [isDragging, setIsDragging] = useState(false)

    /**
     * Grows the field with its content up to `TEXTAREA_MAX_HEIGHT`, then lets
     * it scroll. Driven only from the layout effect below, which covers every
     * way `input` can move — typing, a restored draft, a suggestion pill, a
     * queued message pulled back in, the mic — because the field is controlled
     * and so each of those is a re-render.
     */
    const resizeTextarea = useCallback(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.style.height = 'auto'
      const nextHeight = Math.min(textarea.scrollHeight, TEXTAREA_MAX_HEIGHT)
      textarea.style.height = `${Math.max(nextHeight, TEXTAREA_MIN_HEIGHT)}px`
      textarea.style.overflowY =
        textarea.scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden'
    }, [])

    // `useLayoutEffect`, not `useEffect` (which the repo bans) and not derived
    // state: this is a DOM measurement that has to land before paint, or the
    // pill visibly jumps a frame after a multi-line draft is restored. There is
    // no render-time equivalent — the height depends on `scrollHeight`, which
    // only exists once the new value is in the DOM.
    useLayoutEffect(() => {
      resizeTextarea()
    }, [input, resizeTextarea])

    // Track latest attachments in a ref so unmount cleanup doesn't fire on
    // every re-render (a plain per-render effect would revoke URLs still
    // referenced by rendered <img src=...> nodes). Revocation on
    // remove/clear happens inline in the event handlers below. This is the
    // one tolerated `useEffect` (unmount-only cleanup).
    const attachmentsRef = useRef(attachments)
    attachmentsRef.current = attachments
    useEffect(() => {
      return () => {
        attachmentsRef.current.forEach((item) =>
          URL.revokeObjectURL(item.previewUrl),
        )
      }
    }, [])

    const clearAttachments = () => {
      attachments.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      setAttachments([])
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }

    const handleFiles = (fileList: FileList | File[] | null) => {
      if (!fileList) return
      const array = Array.isArray(fileList) ? fileList : Array.from(fileList)
      if (array.length === 0) return
      const next = array.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      }))
      setAttachments((current) => [...current, ...next])
    }

    // Bound to the pill rather than the field so a paste onto the composer's
    // chrome still attaches. Text paste keeps the browser default — only
    // clipboard *files* are intercepted.
    const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
      const files = Array.from(event.clipboardData?.files ?? [])
      if (files.length === 0) return
      event.preventDefault()
      handleFiles(files)
    }

    const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer?.types?.includes('Files')) return
      event.preventDefault()
      dragDepthRef.current += 1
      setIsDragging(true)
    }

    const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer?.types?.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }

    const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer?.types?.includes('Files')) return
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) setIsDragging(false)
    }

    const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer?.types?.includes('Files')) return
      event.preventDefault()
      dragDepthRef.current = 0
      setIsDragging(false)
      handleFiles(event.dataTransfer.files)
    }

    /**
     * Submit the composer. Mentions are serialized to links here, `/slug`
     * tokens stay literal (2026-09-08 spec §12).
     */
    const handleSubmit = async () => {
      // Submitting mid-turn is no longer an implicit "stop". Before the
      // 2026-09-16 message-queue design, `isStreaming` here aborted the run,
      // so pressing Enter while the agent was mid-reply killed it and dropped
      // the text. Now the submit always hands the payload to `onSend`; the
      // controller parks it in the queue when a turn is in flight and sends it
      // when that turn ends. Stopping stays an explicit press of the stop
      // button, which is wired straight to `onStop` in `ComposerFooter`.
      if (normalizeStatus(status) === 'submitted') return

      if (
        (!input.trim() &&
          attachments.length === 0 &&
          selectedDocuments.length === 0) ||
        hasStaleDocumentSelection
      ) {
        return
      }

      const text = serializeMemberMentions(input, selectedMemberMentions).trim()
      const files = attachments.map((item) => item.file)
      // Clear optimistically: `onSend` resolves only after the whole streaming
      // turn finishes, so deferring the clear would leave the draft and its
      // attachments on screen for the entire reply.
      onInputChange('')
      setSelectedMemberMentions([])
      setCursor(0)
      clearAttachments()
      setSelectedDocumentIds([])
      await onSend({ text, files, selectedDocuments })
    }

    /**
     * Moves the caret after something other than typing rewrites the draft (a
     * menu selection, a restored queue row). The value is applied by React on
     * the next render, so the selection has to be set after that paint — before
     * it, the browser would place the caret against the old value and land it
     * in the wrong spot.
     */
    const restoreCaret = useCallback((position: number) => {
      requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        textarea.focus()
        textarea.setSelectionRange(position, position)
      })
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        restoreDraft: ({ text, files, selectedDocumentIds: documentIds }) => {
          const restored = deserializeMemberMentions(text)
          setSelectedMemberMentions(restored.mentions)
          setCursor(restored.text.length)
          onInputChange(restored.text)
          handleFiles(files)
          setSelectedDocumentIds((current) => [
            ...current,
            ...documentIds.filter((id) => !current.includes(id)),
          ])
          restoreCaret(restored.text.length)
        },
        focus: () => {
          textareaRef.current?.focus()
        },
      }),
      [onInputChange, restoreCaret],
    )

    const skillTrigger = useMemo(
      () => detectSkillTrigger(input, cursor),
      [cursor, input],
    )
    const memberTrigger = useMemo(
      () => detectMemberMentionTrigger(input, cursor),
      [cursor, input],
    )

    const membersQuery = useQuery(memberListOptions(workspaceId))
    const filteredMembers = useMemo(
      () =>
        memberTrigger
          ? searchComposerMembers(membersQuery.data ?? [], memberTrigger.query)
          : [],
      [memberTrigger, membersQuery.data],
    )

    const skillsQuery = useQuery({
      ...agentSkillListOptions(workspaceId, agentId),
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      placeholderData: (previous) => previous,
    })
    const skills = useMemo<ComposerSkill[]>(
      () =>
        (skillsQuery.data ?? [])
          .filter((skill) => skill.enabled)
          .map((skill) => ({
            id: skill.id,
            slug: skill.slug ?? skill.name,
            name: skill.name,
            description: skill.description,
          })),
      [skillsQuery.data],
    )
    // Derived from the live query on every render. The Tiptap suggestion
    // extension captured this list once when the editor was created, so on a
    // cold cache `/` showed "No matching skills" until the composer remounted.
    const filteredSkills = useMemo(() => {
      if (!skillTrigger) return [] as ComposerSkill[]
      return searchComposerSkills(skills, skillTrigger.query)
    }, [skillTrigger, skills])

    /**
     * Popup dismissal and keyboard highlight, both derived rather than reset
     * through effects (`useEffect` is banned here, and the old composer burned
     * two on exactly this).
     *
     * Dismissal remembers the *input* the person pressed Escape on, so the
     * menu stays closed until the text changes again — which is what typing
     * the next character does, reopening it.
     *
     * The highlight remembers the query it belongs to, so a changed query
     * falls back to the first row without a reset pass.
     */
    const [dismissedMenuInput, setDismissedMenuInput] = useState<string | null>(
      null,
    )
    const menuDismissed = dismissedMenuInput === input

    const showSkillMenu = Boolean(skillTrigger) && !menuDismissed
    const showMemberMenu =
      !showSkillMenu && Boolean(memberTrigger) && !menuDismissed

    // Which menu the highlight belongs to. Keying on the menu as well as the
    // query is what stops a highlight set on `/depl` from carrying over to the
    // member list when the same token is retyped as `@depl`.
    const highlightKey = showSkillMenu
      ? `skill:${skillTrigger?.query ?? ''}`
      : showMemberMenu
        ? `member:${memberTrigger?.query ?? ''}`
        : ''
    const [highlight, setHighlight] = useState<{
      key: string
      index: number
    }>({ key: '', index: 0 })
    const highlightedIndex =
      highlight.key === highlightKey ? highlight.index : 0
    const moveHighlight = useCallback(
      (nextIndex: number) =>
        setHighlight({ key: highlightKey, index: nextIndex }),
      [highlightKey],
    )

    const applySkillSelection = useCallback(
      (skill: ComposerSkill) => {
        if (!skillTrigger) return
        const replacement = `${formatSkillInvocation(skill.slug ?? skill.name)} `
        let rangeEnd = skillTrigger.rangeEnd
        if (input[rangeEnd] === ' ') rangeEnd += 1
        const nextValue =
          input.slice(0, skillTrigger.rangeStart) +
          replacement +
          input.slice(rangeEnd)
        const nextCursor = skillTrigger.rangeStart + replacement.length
        setSelectedMemberMentions((current) =>
          rebaseMemberMentions(input, nextValue, current, {
            previousStart: skillTrigger.rangeStart,
            previousEnd: rangeEnd,
            nextEnd: nextCursor,
          }),
        )
        setDismissedMenuInput(null)
        onInputChange(nextValue)
        setCursor(nextCursor)
        restoreCaret(nextCursor)
      },
      [input, onInputChange, restoreCaret, skillTrigger],
    )

    const applyMemberSelection = useCallback(
      (member: (typeof filteredMembers)[number]) => {
        if (!memberTrigger) return
        const replacement = `@${member.name} `
        let rangeEnd = memberTrigger.rangeEnd
        if (input[rangeEnd] === ' ') rangeEnd += 1
        const nextValue =
          input.slice(0, memberTrigger.rangeStart) +
          replacement +
          input.slice(rangeEnd)
        const nextCursor = memberTrigger.rangeStart + replacement.length
        const mentionEnd =
          memberTrigger.rangeStart + replacement.trimEnd().length

        setSelectedMemberMentions((current) => [
          ...rebaseMemberMentions(input, nextValue, current, {
            previousStart: memberTrigger.rangeStart,
            previousEnd: rangeEnd,
            nextEnd: nextCursor,
          }),
          {
            id: member.user_id,
            label: member.name,
            start: memberTrigger.rangeStart,
            end: mentionEnd,
          },
        ])
        setDismissedMenuInput(null)
        onInputChange(nextValue)
        setCursor(nextCursor)
        restoreCaret(nextCursor)
      },
      [input, memberTrigger, onInputChange, restoreCaret],
    )

    /**
     * Click-to-focus for the whole composer pill.
     *
     * The pill reads as one input field, so any press inside it should put the
     * caret in the field — except on the field itself (the browser places the
     * caret at the click position, which beats our `focus()`) and on real
     * controls, whose own focus and activation must not be stolen.
     *
     * `onMouseDown` + `preventDefault`, not `onClick`: by click time the
     * browser has already moved focus and begun a text selection from the
     * chrome, so focusing there fights what just happened.
     */
    const handlePillMouseDown = useCallback(
      (event: ReactMouseEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement
        if (
          target.closest(
            'a, button, input, textarea, select, label, [role="button"], [role="menuitem"], [role="combobox"], [data-composer-keep-focus]',
          )
        ) {
          return
        }
        event.preventDefault()
        const textarea = textareaRef.current
        if (!textarea) return
        textarea.focus()
        textarea.setSelectionRange(input.length, input.length)
      },
      [input.length],
    )

    const hasContent =
      input.trim().length > 0 ||
      attachments.length > 0 ||
      selectedDocuments.length > 0
    const isSubmitted = normalizeStatus(status) === 'submitted'

    return (
      <div className="shrink-0 px-4 pb-3">
        {selectedDocumentIds.length > 0 ? (
          <div
            className={cn(
              'mx-auto mb-2 flex gap-2 overflow-x-auto pb-1',
              COMPOSER_WIDTH_CLASS_NAME,
            )}
          >
            {selectedDocumentIds.map((documentId) => {
              const document = documents.find(
                (candidate) => candidate.documentId === documentId,
              )
              return (
                <div
                  key={documentId}
                  className={cn(
                    'group relative flex h-14 w-52 shrink-0 items-center gap-2.5 rounded-lg border bg-muted/40 px-3',
                    !document && 'border-destructive/40',
                  )}
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-xs font-medium">
                      {document?.filename ?? 'Document unavailable'}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {document?.meta ?? 'Remove and select it again'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedDocumentIds((current) =>
                        current.filter((id) => id !== documentId),
                      )
                    }
                    className="absolute right-1 top-1 rounded-full bg-background/85 p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`Remove ${document?.filename ?? 'unavailable document'}`}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )
            })}
          </div>
        ) : null}

        {attachments.length > 0 ? (
          <div
            className={cn(
              'mx-auto mb-2 flex gap-2 overflow-x-auto pb-1',
              COMPOSER_WIDTH_CLASS_NAME,
            )}
          >
            {attachments.map((item) => {
              const kind = getFileKind({
                mediaType: item.file.type,
                filename: item.file.name,
              })
              const isImage = kind === 'image'
              return (
                <div
                  key={item.id}
                  className={cn(
                    'group relative shrink-0 overflow-hidden rounded-lg border bg-muted/40',
                    isImage
                      ? 'h-20 w-24'
                      : 'flex h-20 w-44 items-center gap-2.5 px-3',
                  )}
                  title={item.file.name}
                >
                  {isImage ? (
                    <img
                      src={item.previewUrl}
                      alt={item.file.name}
                      className="size-full object-cover"
                    />
                  ) : (
                    <>
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-background/70">
                        <FileKindIcon
                          kind={kind}
                          className="text-foreground/70"
                        />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-xs font-medium leading-tight">
                          {item.file.name}
                        </span>
                        <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
                          {getFileKindLabel(kind)}
                        </span>
                      </div>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((current) => {
                        const next = current.filter(
                          (entry) => entry.id !== item.id,
                        )
                        URL.revokeObjectURL(item.previewUrl)
                        return next
                      })
                    }
                    className="absolute right-1 top-1 rounded-full bg-background/85 p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`Remove ${item.file.name}`}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )
            })}
          </div>
        ) : null}

        <div className={cn('mx-auto', COMPOSER_WIDTH_CLASS_NAME)}>
          {/*
            Queued messages slab — it renders here, as a sibling of the pill
            inside this wrapper, so it can tuck behind the pill's rounded top
            edge and read as one shape. It disappears on its own when the queue
            is empty.
          */}
          {queue}
          <div
            data-testid="composer-pill"
            className={cn(
              'relative z-10 flex flex-col gap-3 rounded-2xl border border-border-default bg-background-main-default p-4 shadow-5 transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-border-brand-secondary focus-within:border-border-brand-secondary',
              /*
               * The I-beam advertises `handlePillMouseDown`: the chrome around
               * the field is clickable as text, so it should look clickable as
               * text.
               *
               * The `:is(...)` reset is required, not belt-and-braces. `cursor`
               * is an inherited property and Tailwind v4's preflight sets no
               * cursor on `button`, so `cursor-text` alone would inherit
               * straight into every control in the footer. `cursor-auto`
               * restores exactly what they had before, since nothing here
               * declared a cursor of its own.
               *
               * The selector list mirrors the skip list in
               * `handlePillMouseDown` above — same elements, same reason — but
               * is written out literally because Tailwind scans source
               * statically and cannot read a shared constant.
               */
              'cursor-text [&_:is(button,input,textarea,select,label,[role=button],[role=menuitem],[role=combobox],[data-composer-keep-focus])]:cursor-auto',
              isDragging && 'border-dashed border-border-brand-secondary',
            )}
            onMouseDown={handlePillMouseDown}
            onPointerEnter={onWarmRuntime}
            onPaste={handlePaste}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isDragging ? (
              <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-2xl border border-dashed border-border-brand-secondary bg-background-brand-tertiary/70 backdrop-blur-[1px]">
                <div className="flex items-center gap-2 rounded-pill bg-background-main-default/90 px-3 py-1.5 text-xs font-medium text-text-default shadow-2">
                  <Paperclip className="size-3.5 text-icon-brand-secondary" />
                  Drop to attach
                </div>
              </div>
            ) : null}

            {showSkillMenu ? (
              <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-2xl border border-border-default bg-background-main-default shadow-5">
                <Command shouldFilter={false} className="bg-transparent p-1">
                  <CommandList className="max-h-72">
                    {filteredSkills.length > 0 ? (
                      <CommandGroup heading="Skills">
                        {filteredSkills.map((skill, index) => (
                          <CommandItem
                            key={skill.id}
                            value={skill.id}
                            className={cn(
                              'cursor-pointer select-none gap-2 hover:bg-transparent hover:text-inherit data-[selected=true]:bg-transparent data-[selected=true]:text-inherit',
                              highlightedIndex === index &&
                                'font-medium text-text-brand-secondary',
                            )}
                            onMouseMove={() => {
                              if (highlightedIndex !== index) {
                                moveHighlight(index)
                              }
                            }}
                            onMouseDown={(event) => event.preventDefault()}
                            onSelect={() => applySkillSelection(skill)}
                            onClick={() => applySkillSelection(skill)}
                          >
                            <span className="inline-flex size-4 shrink-0 items-center justify-center text-icon-secondary">
                              <SkillGlyph className="size-3.5" />
                            </span>
                            <span className="flex min-w-0 flex-1 items-center gap-2">
                              <span className="shrink-0">
                                {formatSkillInvocation(
                                  skill.slug ?? skill.name,
                                )}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                                {skill.description || 'Workspace skill'}
                              </span>
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ) : skillsQuery.isError ? (
                      <div className="px-3 py-2.5 text-xs text-text-danger-default">
                        Failed to load skills. Try again later.
                      </div>
                    ) : skillsQuery.isFetching && skills.length === 0 ? (
                      <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-text-secondary">
                        <Loader2 className="size-3.5 animate-spin" />
                        <span>Loading skills…</span>
                      </div>
                    ) : (
                      <div className="px-3 py-2.5 text-xs text-text-secondary">
                        {skills.length === 0
                          ? 'No skills available for this agent.'
                          : 'No matching skills.'}
                      </div>
                    )}
                  </CommandList>
                </Command>
              </div>
            ) : showMemberMenu ? (
              <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-2xl border border-border-default bg-background-main-default shadow-5">
                <Command shouldFilter={false} className="bg-transparent p-1">
                  <CommandList className="max-h-72">
                    {filteredMembers.length > 0 ? (
                      <CommandGroup heading="Members">
                        {filteredMembers.map((member, index) => (
                          <CommandItem
                            key={member.user_id}
                            value={member.user_id}
                            className={cn(
                              'cursor-pointer select-none gap-2 hover:bg-transparent hover:text-inherit data-[selected=true]:bg-transparent data-[selected=true]:text-inherit',
                              highlightedIndex === index &&
                                'bg-background-main-tertiary',
                            )}
                            onMouseMove={() => {
                              if (highlightedIndex !== index) {
                                moveHighlight(index)
                              }
                            }}
                            onMouseDown={(event) => event.preventDefault()}
                            onSelect={() => applyMemberSelection(member)}
                            onClick={() => applyMemberSelection(member)}
                          >
                            <ActorAvatar
                              actorType="member"
                              actorId={member.user_id}
                              size={20}
                            />
                            <span className="min-w-0 flex-1 truncate font-medium">
                              @{member.name}
                            </span>
                            <span className="max-w-40 truncate text-xs text-text-secondary">
                              {member.email}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ) : membersQuery.isFetching ? (
                      <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-text-secondary">
                        <Loader2 className="size-3.5 animate-spin" />
                        <span>Loading members…</span>
                      </div>
                    ) : (
                      <div className="px-3 py-2.5 text-xs text-text-secondary">
                        No matching members
                      </div>
                    )}
                  </CommandList>
                </Command>
              </div>
            ) : null}

            {pendingQuestions &&
            pendingQuestions.length > 0 &&
            onSubmitAnswers ? (
              /*
               * `data-composer-keep-focus` opts this subtree out of the pill's
               * click-to-focus (see `handlePillMouseDown`). While the agent is
               * asking structured questions the panel — not the field — is what
               * the user is answering, so a click on its padding must not yank
               * the caret down into the composer mid-answer.
               */
              <div data-composer-keep-focus>
                <StructuredInputPanel
                  questions={pendingQuestions}
                  onSubmit={onSubmitAnswers}
                  disabled={isStreaming}
                />
              </div>
            ) : null}

            <Textarea
              ref={textareaRef}
              data-testid="composer-input"
              value={input}
              rows={1}
              placeholder="Make requests with Garden AI..."
              style={{
                height: TEXTAREA_MIN_HEIGHT,
                maxHeight: TEXTAREA_MAX_HEIGHT,
              }}
              className="[field-sizing:fixed]! min-h-7 resize-none overflow-hidden border-0 bg-transparent text-sm leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
              onFocus={onWarmRuntime}
              onBeforeInput={(event) => {
                pendingTextEditRef.current = {
                  selectionStart: event.currentTarget.selectionStart ?? cursor,
                  selectionEnd: event.currentTarget.selectionEnd ?? cursor,
                  inputType: (event.nativeEvent as InputEvent).inputType ?? '',
                }
              }}
              onChange={(event) => {
                const nextValue = event.target.value
                const pendingEdit = pendingTextEditRef.current
                pendingTextEditRef.current = null
                setSelectedMemberMentions((current) =>
                  rebaseMemberMentions(
                    input,
                    nextValue,
                    current,
                    pendingEdit
                      ? resolveMemberMentionTextEdit({
                          previousInput: input,
                          nextInput: nextValue,
                          ...pendingEdit,
                        })
                      : undefined,
                  ),
                )
                setCursor(event.target.selectionStart ?? nextValue.length)
                onInputChange(nextValue)
              }}
              onClick={(event) =>
                setCursor(event.currentTarget.selectionStart ?? input.length)
              }
              onKeyUp={(event) =>
                setCursor(event.currentTarget.selectionStart ?? input.length)
              }
              onSelect={(event) =>
                setCursor(event.currentTarget.selectionStart ?? input.length)
              }
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return

                if (showMemberMenu) {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setDismissedMenuInput(input)
                    return
                  }
                  if (filteredMembers.length > 0) {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      moveHighlight(
                        (highlightedIndex + 1) % filteredMembers.length,
                      )
                      return
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      moveHighlight(
                        (highlightedIndex - 1 + filteredMembers.length) %
                          filteredMembers.length,
                      )
                      return
                    }
                    if (
                      isMemberMentionSelectionKey({
                        key: event.key,
                        isComposing: event.nativeEvent.isComposing,
                      })
                    ) {
                      event.preventDefault()
                      const member =
                        filteredMembers[highlightedIndex] ?? filteredMembers[0]
                      if (member) applyMemberSelection(member)
                      return
                    }
                  }
                }

                if (showSkillMenu) {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setDismissedMenuInput(input)
                    return
                  }
                  if (filteredSkills.length > 0) {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      moveHighlight(
                        (highlightedIndex + 1) % filteredSkills.length,
                      )
                      return
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      moveHighlight(
                        (highlightedIndex - 1 + filteredSkills.length) %
                          filteredSkills.length,
                      )
                      return
                    }
                    // Tab, not Enter: a `/` token is legal prose, so Enter
                    // stays "send" while the skill menu is open.
                    if (event.key === 'Tab') {
                      event.preventDefault()
                      const skill =
                        filteredSkills[highlightedIndex] ?? filteredSkills[0]
                      if (skill) applySkillSelection(skill)
                      return
                    }
                  }
                }

                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSubmit()
                }
              }}
            />

            <ComposerFooter
              addMenu={
                <ComposerAddMenu
                  onUploadClick={() => fileInputRef.current?.click()}
                />
              }
              toolsMenu={
                <ComposerToolsMenu
                  presetId={toolPreset}
                  onPresetChange={setToolPreset}
                />
              }
              onMicTranscription={(value) =>
                onInputChange(input ? `${input.trimEnd()} ${value}` : value)
              }
              isStreaming={isStreaming}
              hasContent={hasContent}
              isSubmitted={isSubmitted}
              hasStaleDocumentSelection={hasStaleDocumentSelection}
              onSend={() => void handleSubmit()}
              onStop={() => void onStop()}
            />
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          hidden
          data-testid="composer-file-input"
          accept={ACCEPTED_FILE_TYPES}
          multiple
          onChange={(event) => {
            handleFiles(event.target.files)
            // Reset so re-selecting the same file re-triggers change.
            event.target.value = ''
          }}
        />
      </div>
    )
  },
)
