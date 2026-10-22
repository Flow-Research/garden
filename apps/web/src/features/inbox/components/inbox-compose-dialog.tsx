import {
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import {
  Image as ImageIcon,
  Link,
  Loader2,
  Paperclip,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@garden/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@garden/ui/components/ui/dialog'
import { Input } from '@garden/ui/components/ui/input'
import { Label } from '@garden/ui/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@garden/ui/components/ui/popover'
import { QuickEmojiPicker } from '@garden/ui/components/common/quick-emoji-picker'
import { cn } from '@garden/ui/lib/utils'
import { toast } from 'sonner'
import {
  ApiError,
  deleteGmailDraft,
  getGmailDraft,
  saveGmailDraft,
  sendGmail,
} from '@/lib/api'
import { executorOAuthStartUrl } from '@/lib/api/executor'
import type { GmailDraftDetail } from '@/lib/api/gmail-contract'
import {
  ComposeMessageBody,
  normalizeHref,
  type ComposeMessageBodyRef,
} from './inbox-compose-body'

const fieldInputClassName =
  'h-8 border-0 bg-transparent px-3 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const AVATAR_TONES = [
  'bg-brand text-brand-foreground',
  'bg-[color:var(--background-success-default)] text-[color:var(--text-success-on-success)]',
  'bg-[color:var(--background-warning-default)] text-[color:var(--text-warning-on-warning)]',
  'bg-[color:var(--blue-600)] text-white',
] as const

type InboxComposeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  draftId?: string | null
}

export function InboxComposeDialog({
  open,
  onOpenChange,
  draftId,
}: InboxComposeDialogProps) {
  const editingId = open && draftId ? draftId : null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {editingId ? (
        <DraftLoader
          key={editingId}
          draftId={editingId}
          onOpenChange={onOpenChange}
        />
      ) : open ? (
        <ComposeForm key="new" initial={null} onOpenChange={onOpenChange} />
      ) : null}
    </Dialog>
  )
}

function DraftLoader({
  draftId,
  onOpenChange,
}: {
  draftId: string
  onOpenChange: (open: boolean) => void
}) {
  const draftQuery = useQuery({
    queryKey: ['gmail', 'draft', draftId],
    queryFn: () => getGmailDraft(draftId),
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  })

  if (draftQuery.isPending) {
    return (
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogTitle className="sr-only">Loading draft</DialogTitle>
        <DialogDescription className="sr-only">
          The saved Gmail draft is loading.
        </DialogDescription>
        <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading draft...
        </div>
      </DialogContent>
    )
  }

  if (draftQuery.isError) {
    const missing =
      draftQuery.error instanceof ApiError && draftQuery.error.status === 409
    return (
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogTitle className="sr-only">Draft unavailable</DialogTitle>
        <DialogDescription className="sr-only">
          The saved Gmail draft could not be loaded.
        </DialogDescription>
        <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {missing
              ? 'Gmail is not connected, so the draft cannot be loaded.'
              : 'The draft could not be loaded.'}
          </p>
          {missing ? (
            <ConnectGmailButton label="Connect Gmail" />
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          )}
        </div>
      </DialogContent>
    )
  }

  return (
    <ComposeForm
      key={draftQuery.data.draftId}
      initial={draftQuery.data}
      onOpenChange={onOpenChange}
    />
  )
}

function ConnectGmailButton({ label }: { label: string }) {
  return (
    <Button
      type="button"
      onClick={() => {
        window.location.assign(executorOAuthStartUrl('google_gmail', 'user'))
      }}
    >
      {label}
    </Button>
  )
}

function ComposeForm({
  initial,
  onOpenChange,
}: {
  initial: GmailDraftDetail | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const bodyRef = useRef<ComposeMessageBodyRef>(null)
  const [to, setTo] = useState<string[]>(initial ? [...initial.to] : [])
  const [cc, setCc] = useState<string[]>(initial ? [...initial.cc] : [])
  const [bcc, setBcc] = useState<string[]>(initial ? [...initial.bcc] : [])
  const [subject, setSubject] = useState(initial?.subject ?? '')
  const [body, setBody] = useState(initial?.bodyText ?? '')
  const [showCc, setShowCc] = useState((initial?.cc.length ?? 0) > 0)
  const [showBcc, setShowBcc] = useState((initial?.bcc.length ?? 0) > 0)
  const [savedDraftId, setSavedDraftId] = useState<string | null>(
    initial?.draftId ?? null,
  )
  const [needsConnect, setNeedsConnect] = useState(false)

  const invalidateGmail = () => {
    queryClient.invalidateQueries({ queryKey: ['gmail'] })
  }

  const mutationError = (error: unknown, fallback: string) => {
    if (error instanceof ApiError && error.status === 409) {
      setNeedsConnect(true)
      return
    }
    toast.error(error instanceof Error ? error.message : fallback)
  }

  const saveMutation = useMutation({
    mutationFn: saveGmailDraft,
    onSuccess: (draft) => {
      setSavedDraftId(draft.draftId)
      setNeedsConnect(false)
      invalidateGmail()
      toast.success('Draft saved to Gmail.')
    },
    onError: (error) => mutationError(error, 'Could not save the draft.'),
  })

  const sendMutation = useMutation({
    mutationFn: sendGmail,
    onSuccess: () => {
      setNeedsConnect(false)
      invalidateGmail()
      toast.success('Message sent.')
      onOpenChange(false)
    },
    onError: (error) => mutationError(error, 'Could not send the message.'),
  })

  const discardMutation = useMutation({
    mutationFn: deleteGmailDraft,
    onSuccess: () => {
      invalidateGmail()
      onOpenChange(false)
    },
    onError: (error) => mutationError(error, 'Could not discard the draft.'),
  })

  const pending =
    saveMutation.isPending ||
    sendMutation.isPending ||
    discardMutation.isPending
  const draftId = savedDraftId

  const buildInput = () => ({
    ...(draftId ? { draftId } : {}),
    to,
    cc,
    bcc,
    subject,
    body,
  })

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    if (to.length === 0 || !body.trim()) return
    sendMutation.mutate(buildInput())
  }

  const handleSaveDraft = () => {
    if (pending) return
    if (to.length === 0 && !body.trim() && !subject.trim()) return
    saveMutation.mutate({
      ...(draftId ? { draftId } : {}),
      to,
      cc,
      bcc,
      subject,
      body,
    })
  }

  const handleDiscard = () => {
    if (pending) return
    if (draftId) {
      discardMutation.mutate(draftId)
      return
    }
    onOpenChange(false)
  }

  const canSend = to.length > 0 && body.trim().length > 0 && !pending

  return (
    <DialogContent
      showCloseButton={false}
      className="gap-0 overflow-hidden p-0 sm:max-w-2xl"
    >
      <DialogTitle className="sr-only">Start email</DialogTitle>
      <DialogDescription className="sr-only">
        Compose a new email with recipients, subject, and message.
      </DialogDescription>
      {needsConnect ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/50 px-4 py-2.5">
          <p className="text-xs text-muted-foreground">
            Gmail is not connected. Connect it to save drafts and send.
          </p>
          <ConnectGmailButton label="Connect Gmail" />
        </div>
      ) : null}
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
        <div className="space-y-1 px-4 py-3">
          <ComposeEmailChipRow
            id="inbox-compose-to"
            label="To:"
            emails={to}
            onEmailsChange={setTo}
          />
          {showCc ? (
            <ComposeEmailChipRow
              id="inbox-compose-cc"
              label="Cc:"
              emails={cc}
              onEmailsChange={setCc}
            />
          ) : null}
          {showBcc ? (
            <ComposeEmailChipRow
              id="inbox-compose-bcc"
              label="Bcc:"
              emails={bcc}
              onEmailsChange={setBcc}
            />
          ) : null}
          <ComposeAddressRow
            id="inbox-compose-subject"
            label="Subject:"
            placeholder="Add a subject"
            value={subject}
            onChange={setSubject}
            trailing={
              <div className="flex shrink-0 items-center gap-3">
                {!showCc ? (
                  <button
                    type="button"
                    className="text-sm font-medium text-muted-foreground hover:text-foreground"
                    onClick={() => setShowCc(true)}
                  >
                    Cc
                  </button>
                ) : null}
                {!showBcc ? (
                  <button
                    type="button"
                    className="text-sm font-medium text-muted-foreground hover:text-foreground"
                    onClick={() => setShowBcc(true)}
                  >
                    Bcc
                  </button>
                ) : null}
              </div>
            }
          />
        </div>

        <ComposeMessageBody
          ref={bodyRef}
          key={initial?.draftId ?? 'new'}
          initialText={initial?.bodyText}
          placeholder="Write your message here..."
          onChange={setBody}
        />

        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              disabled={!canSend}
              className="cursor-pointer py-5 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
            >
              {sendMutation.isPending ? 'Sending...' : 'Send message'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer px-5 py-5"
              disabled={pending}
              onClick={handleSaveDraft}
            >
              {saveMutation.isPending ? 'Saving...' : 'Save to draft'}
            </Button>
          </div>
          <div className="flex items-center gap-0.5">
            <QuickEmojiPicker
              align="end"
              className="rounded-lg"
              onSelect={(emoji) => insertText(emoji)}
            />
            <ComposeLinkButton
              onBeforeOpen={() => bodyRef.current?.saveSelection()}
              onInsert={insertLink}
            />
            <ComposeFileButton
              icon={Paperclip}
              label="Attach document (not supported yet)"
              disabled
            />
            <ComposeFileButton
              icon={ImageIcon}
              label="Attach image (not supported yet)"
              disabled
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label="Discard email"
              disabled={pending}
              onClick={handleDiscard}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
        <p className="px-4 pb-3 text-[11px] text-muted-foreground">
          Attachments are not supported yet.
        </p>
      </form>
    </DialogContent>
  )

  function insertText(snippet: string) {
    bodyRef.current?.insertText(snippet)
  }

  function insertLink(text: string, href: string) {
    bodyRef.current?.insertLink(text, href)
  }
}

function ComposeAddressRow({
  id,
  label,
  placeholder,
  type = 'text',
  value,
  onChange,
  trailing,
}: {
  id: string
  label: string
  placeholder: string
  type?: 'text' | 'email'
  value: string
  onChange: (value: string) => void
  trailing?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      <label
        htmlFor={id}
        className="shrink-0 text-sm font-semibold text-foreground"
      >
        {label}
      </label>
      <Input
        id={id}
        type={type}
        autoComplete={type === 'email' ? 'email' : undefined}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={fieldInputClassName}
        wrapperClassName="min-w-0 flex-1"
      />
      {trailing}
    </div>
  )
}

function ComposeEmailChipRow({
  id,
  label,
  emails,
  onEmailsChange,
}: {
  id: string
  label: string
  emails: string[]
  onEmailsChange: (emails: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const [invalid, setInvalid] = useState(false)

  const commitDraft = () => {
    const next = draft.trim()
    if (next.length === 0) return
    if (!EMAIL_PATTERN.test(next)) {
      setInvalid(true)
      return
    }
    const alreadyAdded = emails.some(
      (email) => email.toLowerCase() === next.toLowerCase(),
    )
    if (!alreadyAdded) onEmailsChange([...emails, next])
    setDraft('')
    setInvalid(false)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitDraft()
      return
    }
    if (event.key === 'Backspace' && draft.length === 0 && emails.length > 0) {
      event.preventDefault()
      onEmailsChange(emails.slice(0, -1))
    }
  }

  return (
    <div className="flex items-start gap-3">
      <label
        htmlFor={id}
        className="mt-1.5 shrink-0 text-sm font-semibold text-foreground"
      >
        {label}
      </label>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {emails.map((email) => (
          <EmailChip
            key={email}
            email={email}
            onRemove={() =>
              onEmailsChange(emails.filter((item) => item !== email))
            }
          />
        ))}
        <Input
          id={id}
          type="text"
          inputMode="email"
          autoComplete="email"
          placeholder="Enter an email"
          value={draft}
          aria-invalid={invalid || undefined}
          onChange={(event) => {
            setDraft(event.target.value)
            if (invalid) setInvalid(false)
          }}
          onKeyDown={handleKeyDown}
          onBlur={commitDraft}
          className={fieldInputClassName}
          wrapperClassName="min-w-[10rem] flex-1"
        />
      </div>
    </div>
  )
}

function EmailChip({
  email,
  onRemove,
}: {
  email: string
  onRemove: () => void
}) {
  const localPart = email.split('@')[0] ?? email
  const initial = (localPart[0] ?? '?').toLowerCase()
  const tone = avatarTone(email)

  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-0.5">
      <span
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium',
          tone,
        )}
      >
        {initial}
      </span>
      <span className="max-w-56 truncate text-sm text-foreground">{email}</span>
      <button
        type="button"
        className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
        aria-label={`Remove ${email}`}
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    </span>
  )
}

function avatarTone(email: string) {
  let hash = 0
  for (const char of email) {
    hash = (hash + char.charCodeAt(0)) % AVATAR_TONES.length
  }
  return AVATAR_TONES[hash] ?? AVATAR_TONES[0]
}

function ComposeLinkButton({
  onInsert,
  onBeforeOpen,
}: {
  onInsert: (text: string, href: string) => void
  onBeforeOpen: () => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')

  const reset = () => {
    setText('')
    setUrl('')
  }

  const insertLink = () => {
    const label = text.trim()
    const href = normalizeHref(url.trim())
    if (!href) return
    onInsert(label.length > 0 ? label : href, href)
    reset()
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) onBeforeOpen()
        setOpen(nextOpen)
        if (!nextOpen) reset()
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label="Enter link"
          />
        }
      >
        <Link className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>Enter link</PopoverTitle>
          <PopoverDescription>
            Embed a labeled URL in the message.
          </PopoverDescription>
        </PopoverHeader>
        <div className="grid gap-2">
          <div className="grid gap-1">
            <Label htmlFor="inbox-compose-link-text">Text</Label>
            <Input
              id="inbox-compose-link-text"
              placeholder="Link text"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="inbox-compose-link-url">Link</Label>
            <Input
              id="inbox-compose-link-url"
              type="url"
              placeholder="https://"
              value={url}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  insertLink()
                }
              }}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={url.trim().length === 0}
            onClick={insertLink}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ComposeFileButton({
  icon: Icon,
  label,
  disabled,
}: {
  icon: LucideIcon
  label: string
  disabled?: boolean
}) {
  if (disabled) {
    return (
      <span
        title={label}
        aria-label={label}
        aria-disabled="true"
        className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground/40"
      >
        <Icon className="size-4" aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </span>
    )
  }
  return (
    <label className="relative inline-flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
      <Icon className="size-4" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </label>
  )
}

export type { InboxComposeDialogProps }
