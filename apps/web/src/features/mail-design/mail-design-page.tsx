import { Button } from '@garden/ui/components/ui/button'
import { Badge } from '@garden/ui/components/ui/badge'
import { Bot, Inbox, PenLine, Settings2, Sparkles } from 'lucide-react'
import { useState } from 'react'
import {
  MailComposer,
  MailConversationDetail,
  MailConversationList,
  MailConversationRow,
  MailDetailToolbar,
  MailListToolbar,
  MailSplitView,
  type MailComposerValues,
  type MailScope,
} from '@/features/inbox/components/mail'
import { MailTab } from '@/features/settings/components/mail-tab'
import {
  mailDesignComposerValues,
  mailDesignConversations,
  populatedMailSettingsController,
  setupMailSettingsController,
} from './mail-design-fixtures'

type MailDesignState = 'inbox' | 'compose' | 'admin' | 'setup'

const designStates: ReadonlyArray<{
  value: MailDesignState
  label: string
  icon: typeof Inbox
}> = [
  { value: 'inbox', label: 'Inbox + thread', icon: Inbox },
  { value: 'compose', label: 'Agent compose', icon: PenLine },
  { value: 'admin', label: 'Mail admin', icon: Settings2 },
  { value: 'setup', label: 'Domain setup', icon: Sparkles },
]

/**
 * Public visual reference for Garden Mail. It renders real product components
 * against obvious fixture data so product states can be reviewed without a
 * provisioned Cloudflare domain or an authenticated workspace.
 */
export function MailDesignPage() {
  const [state, setState] = useState<MailDesignState>('inbox')

  return (
    <main className="h-dvh overflow-y-auto bg-muted/30 p-4 sm:p-6">
      <div className="mx-auto flex min-h-full max-w-[1440px] flex-col gap-4">
        <header className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">
                Garden Mail
              </h1>
              <Badge variant="secondary">Design states · fixture data</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Real inbox and administration components populated for visual
              review. Nothing on this page sends mail or changes workspace data.
            </p>
          </div>
          <nav
            aria-label="Mail design states"
            className="flex flex-wrap items-center gap-1 rounded-xl border bg-background p-1"
          >
            {designStates.map((item) => {
              const Icon = item.icon
              return (
                <Button
                  key={item.value}
                  size="sm"
                  variant={state === item.value ? 'secondary' : 'ghost'}
                  aria-pressed={state === item.value}
                  onClick={() => setState(item.value)}
                >
                  <Icon />
                  {item.label}
                </Button>
              )
            })}
          </nav>
        </header>

        <section
          data-design-state={state}
          className="min-h-[760px] flex-1 overflow-hidden rounded-2xl border bg-background shadow-sm"
        >
          {state === 'inbox' ? (
            <InboxDesignState />
          ) : state === 'compose' ? (
            <AgentComposeDesignState />
          ) : state === 'admin' ? (
            <SettingsDesignState />
          ) : (
            <SetupDesignState />
          )}
        </section>
      </div>
    </main>
  )
}

/** Populated shared inbox with one selected human/agent collaboration thread. */
function InboxDesignState() {
  const [selectedId, setSelectedId] = useState('diligence')
  const [expandedMessageIds, setExpandedMessageIds] = useState<
    ReadonlySet<string>
  >(new Set(['diligence-inbound', 'diligence-agent-draft']))
  const [scope, setScope] = useState<MailScope>('mail')
  const [search, setSearch] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const selectedConversation =
    mailDesignConversations.find(
      (conversation) => conversation.id === selectedId,
    ) ?? mailDesignConversations[0]
  const normalizedSearch = search.trim().toLowerCase()
  const conversations = mailDesignConversations.filter(
    (conversation) =>
      (!unreadOnly || conversation.unread) &&
      (!normalizedSearch ||
        conversation.subject.toLowerCase().includes(normalizedSearch) ||
        conversation.snippet.toLowerCase().includes(normalizedSearch)),
  )

  /** Keeps expanded thread message state immutable and local to the gallery. */
  const toggleMessage = (messageId: string) => {
    setExpandedMessageIds((current) => {
      const next = new Set(current)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

  const list = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center border-b px-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Investor Relations</p>
          <p className="truncate text-xs text-muted-foreground">
            investors@garden.co · Seyi + IR Agent
          </p>
        </div>
        <Button size="sm">
          <PenLine />
          Compose
        </Button>
      </div>
      <MailListToolbar
        scope={scope}
        search={search}
        unreadOnly={unreadOnly}
        selectedCount={0}
        compact={false}
        searchExpanded
        filterSummary="Shared mailbox · Investor"
        onScopeChange={setScope}
        onSearchChange={setSearch}
        onUnreadOnlyChange={setUnreadOnly}
        onSearchExpandedChange={() => undefined}
        onOpenFilters={() => undefined}
        onClearFilters={() => undefined}
        onClearSelection={() => undefined}
      />
      <div className="min-h-0 flex-1">
        <MailConversationList
          state="ready"
          conversations={[...conversations]}
          filtered={unreadOnly || normalizedSearch.length > 0}
          renderConversation={(conversation) => (
            <MailConversationRow
              key={conversation.id}
              conversation={conversation}
              selected={conversation.id === selectedId}
              onOpen={() => setSelectedId(conversation.id)}
              onToggleStar={() => undefined}
              onToggleImportant={() => undefined}
              onToggleRead={() => undefined}
              onArchive={() => undefined}
              onDelete={() => undefined}
            />
          )}
        />
      </div>
    </div>
  )

  const detail = (
    <MailConversationDetail
      conversation={selectedConversation}
      expandedMessageIds={expandedMessageIds}
      onToggleMessage={toggleMessage}
      toolbar={
        <MailDetailToolbar
          compact={false}
          starred={selectedConversation.starred}
          unread={selectedConversation.unread}
          folders={[
            { id: 'diligence', label: 'Diligence' },
            { id: 'portfolio', label: 'Portfolio' },
          ]}
          onClose={() => undefined}
          onReply={() => undefined}
          onReplyAll={() => undefined}
          onForward={() => undefined}
          onToggleStar={() => undefined}
          onToggleRead={() => undefined}
          onArchive={() => undefined}
          onMove={() => undefined}
          onViewSource={() => undefined}
          onDelete={() => undefined}
        />
      }
      messageActions={(message) =>
        message.status === 'draft'
          ? {
              onSendDraft: () => undefined,
              onEditDraft: () => undefined,
              onDiscardDraft: () => undefined,
            }
          : {
              onReply: () => undefined,
              onReplyAll: () => undefined,
              onForward: () => undefined,
            }
      }
    />
  )

  return (
    <MailSplitView
      compact={false}
      detailOpen
      list={list}
      detail={detail}
      className="h-[760px]"
    />
  )
}

/** Agent-authored composer state makes the approval boundary visible. */
function AgentComposeDesignState() {
  const [values, setValues] = useState<MailComposerValues>(
    mailDesignComposerValues,
  )
  const [ccBccVisible, setCcBccVisible] = useState(true)

  return (
    <div className="grid h-[760px] bg-muted/20 lg:grid-cols-[320px_minmax(0,760px)] lg:justify-center">
      <aside className="border-r bg-background p-6">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Bot className="size-5" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">Agent-authored reply</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          IR Agent can prepare the response and attach approved workspace
          context. A person still owns the external-send decision.
        </p>
        <div className="mt-6 space-y-3 rounded-xl border bg-muted/30 p-4 text-sm">
          <p className="font-medium">Current collaboration</p>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Drafted by</span>
            <span>IR Agent</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Approver</span>
            <span>Seyi</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Status</span>
            <Badge variant="outline">Awaiting approval</Badge>
          </div>
        </div>
      </aside>
      <div className="min-w-0 bg-background">
        <MailComposer
          variant="panel"
          values={values}
          fromOptions={[
            {
              value: 'investors@garden.co',
              label: 'Investor Relations <investors@garden.co>',
            },
            { value: 'seyi@garden.co', label: 'Seyi <seyi@garden.co>' },
          ]}
          attachments={[
            {
              id: 'metrics-pdf',
              filename: 'Garden-Q2-metrics.pdf',
              contentType: 'application/pdf',
              sizeLabel: '2.4 MB',
            },
            {
              id: 'security-pdf',
              filename: 'Security-roadmap.pdf',
              contentType: 'application/pdf',
              sizeLabel: '864 KB',
            },
          ]}
          ccBccVisible={ccBccVisible}
          agentAttribution="Drafted by IR Agent"
          approvalRequired
          onChange={setValues}
          onToggleCcBcc={() => setCcBccVisible((visible) => !visible)}
          onFormat={() => undefined}
          onAttach={() => undefined}
          onRemoveAttachment={() => undefined}
          onSend={() => undefined}
          onSaveDraft={() => undefined}
          onDiscard={() => undefined}
          onClose={() => undefined}
        />
      </div>
    </div>
  )
}

/** Populated day-2 domain, mailbox, address, and access administration. */
function SettingsDesignState() {
  return (
    <div className="h-[760px] overflow-y-auto p-6 sm:p-10">
      <div className="mx-auto max-w-5xl">
        <MailTab controller={populatedMailSettingsController} />
      </div>
    </div>
  )
}

/** First-domain setup state retained alongside the populated admin state. */
function SetupDesignState() {
  return (
    <div className="h-[760px] overflow-y-auto p-6 sm:p-10">
      <div className="mx-auto max-w-5xl">
        <MailTab controller={setupMailSettingsController} />
      </div>
    </div>
  )
}
