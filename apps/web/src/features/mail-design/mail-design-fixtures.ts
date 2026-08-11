import { Result } from 'better-result'
import type {
  MailConversationView,
  MailComposerValues,
} from '@/features/inbox/components/mail'
import type {
  ActiveMailSettingsController,
  MailSettingsCommand,
  MailSettingsCommandError,
  MailSettingsCommandOutcome,
} from '@/features/settings/mail-settings-controller'

export const mailDesignConversations: readonly MailConversationView[] = [
  {
    id: 'diligence',
    subject: 'Series A diligence follow-up',
    participants: [
      { name: 'Maya Chen', address: 'maya@northstar.vc' },
      { name: 'Seyi', address: 'seyi@garden.co' },
      { name: 'IR Agent', address: 'investors@garden.co' },
    ],
    snippet:
      'Thanks for the updated metrics. Could you share the enterprise retention cut and security roadmap?',
    dateLabel: '10:42 AM',
    messageCount: 3,
    unread: true,
    starred: true,
    important: true,
    draft: true,
    needsReply: true,
    labels: [
      { id: 'investor', name: 'Investor', color: '#8b5cf6' },
      { id: 'urgent', name: 'Diligence', color: '#f97316' },
    ],
    messages: [
      {
        id: 'diligence-inbound',
        from: { name: 'Maya Chen', address: 'maya@northstar.vc' },
        to: [{ name: 'Investor Relations', address: 'investors@garden.co' }],
        sentAtLabel: 'Today, 9:18 AM',
        status: 'received',
        textPreview:
          'Thanks for the updated metrics. Could you share the enterprise retention cut and security roadmap?',
        html: `
          <p>Hi Seyi,</p>
          <p>Thanks for the updated metrics. The team has two follow-ups before Friday:</p>
          <ol>
            <li>Enterprise retention by cohort</li>
            <li>The next two quarters of the security roadmap</li>
          </ol>
          <p>Could you also confirm data-room access for Elena?</p>
          <p>Best,<br />Maya</p>
        `,
      },
      {
        id: 'diligence-human',
        from: { name: 'Seyi', address: 'seyi@garden.co' },
        to: [{ name: 'Maya Chen', address: 'maya@northstar.vc' }],
        cc: [{ name: 'IR Agent', address: 'investors@garden.co' }],
        sentAtLabel: 'Today, 9:36 AM',
        status: 'sent',
        textPreview:
          'Absolutely. I added Elena and asked our IR agent to prepare the cohort and roadmap detail.',
        html: `
          <p>Absolutely. I added Elena to the room.</p>
          <p>Our IR agent is preparing the cohort detail and security roadmap now. I’ll review it here before it goes out.</p>
          <p>— Seyi</p>
        `,
      },
      {
        id: 'diligence-agent-draft',
        from: { name: 'IR Agent', address: 'investors@garden.co' },
        to: [{ name: 'Maya Chen', address: 'maya@northstar.vc' }],
        cc: [{ name: 'Seyi', address: 'seyi@garden.co' }],
        sentAtLabel: 'Draft updated 10:42 AM',
        status: 'draft',
        draftStatus: 'awaiting_approval',
        agentAuthored: true,
        authorLabel: 'IR Agent · approval required',
        textPreview:
          'Enterprise NRR is 142%. Attached is the cohort breakdown and security roadmap requested.',
        html: `
          <p>Hi Maya,</p>
          <p>Enterprise NRR is <strong>142%</strong>, with expansion concentrated in multi-team deployments. The attached cohort view separates new-logo and expansion retention.</p>
          <p>We also included the security roadmap through Q2, covering SSO policy controls, audit export, and regional data residency.</p>
          <p>Best,<br />Garden Investor Relations</p>
        `,
        attachments: [
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
        ],
      },
    ],
  },
  {
    id: 'data-room',
    subject: 'Updated data room access',
    participants: [
      { name: 'Jordan Lee', address: 'jordan@juniper.capital' },
      { name: 'Seyi', address: 'seyi@garden.co' },
    ],
    snippet:
      'The new financial model is visible now. Everything looks good from our side.',
    dateLabel: 'Yesterday',
    messageCount: 2,
    unread: false,
    starred: true,
    labels: [{ id: 'investor', name: 'Investor', color: '#8b5cf6' }],
    messages: [
      {
        id: 'data-room-message',
        from: { name: 'Jordan Lee', address: 'jordan@juniper.capital' },
        to: [{ name: 'Seyi', address: 'seyi@garden.co' }],
        sentAtLabel: 'Yesterday, 4:22 PM',
        status: 'received',
        textPreview: 'The new financial model is visible now.',
        html: '<p>The new financial model is visible now. Everything looks good from our side.</p>',
      },
      {
        id: 'data-room-reply',
        from: { name: 'Seyi', address: 'seyi@garden.co' },
        to: [{ name: 'Jordan Lee', address: 'jordan@juniper.capital' }],
        sentAtLabel: 'Yesterday, 4:31 PM',
        status: 'sent',
        html: '<p>Great — let me know if you want any other cuts of the model.</p>',
      },
    ],
  },
  {
    id: 'board-language',
    subject: 'Board observer language',
    participants: [
      { name: 'Elena Ruiz', address: 'elena@northstar.vc' },
      { name: 'Legal Agent', address: 'legal@garden.co' },
    ],
    snippet:
      'Legal Agent drafted a response comparing the current language to our standard observer terms.',
    dateLabel: 'Mon',
    messageCount: 5,
    unread: false,
    starred: false,
    draft: true,
    labels: [{ id: 'legal', name: 'Legal', color: '#0ea5e9' }],
    messages: [
      {
        id: 'board-message',
        from: { name: 'Elena Ruiz', address: 'elena@northstar.vc' },
        to: [{ name: 'Legal', address: 'legal@garden.co' }],
        sentAtLabel: 'Monday, 2:11 PM',
        status: 'received',
        html: '<p>Could your team review the observer language in section 4?</p>',
      },
    ],
  },
  {
    id: 'finch-intro',
    subject: 'Intro: Finch Capital × Garden',
    participants: [{ name: 'Amara Okafor', address: 'amara@finch.capital' }],
    snippet:
      'Loved the product demo. Looping in our enterprise software partner for a conversation next week.',
    dateLabel: 'Fri',
    messageCount: 1,
    unread: true,
    starred: false,
    needsReply: true,
    labels: [{ id: 'intro', name: 'Warm intro', color: '#22c55e' }],
    messages: [
      {
        id: 'finch-message',
        from: { name: 'Amara Okafor', address: 'amara@finch.capital' },
        to: [{ name: 'Investor Relations', address: 'investors@garden.co' }],
        sentAtLabel: 'Friday, 11:06 AM',
        status: 'received',
        html: '<p>Loved the product demo. Looping in our enterprise software partner for a conversation next week.</p>',
      },
    ],
  },
]

export const mailDesignComposerValues: MailComposerValues = {
  to: 'Maya Chen <maya@northstar.vc>',
  cc: 'Seyi <seyi@garden.co>',
  bcc: '',
  from: 'investors@garden.co',
  subject: 'Re: Series A diligence follow-up',
  body: `Hi Maya,

Enterprise NRR is 142%, with expansion concentrated in multi-team deployments. I attached the cohort breakdown and our security roadmap through Q2.

Best,
Garden Investor Relations`,
}

/** Returns a successful typed command without mutating product or fixture state. */
function fixtureCommand(
  outcome: MailSettingsCommandOutcome,
): MailSettingsCommand {
  return Promise.resolve(
    Result.ok<MailSettingsCommandOutcome, MailSettingsCommandError>(outcome),
  )
}

export const populatedMailSettingsController: ActiveMailSettingsController = {
  status: 'ready',
  canManage: true,
  domains: [
    {
      id: 'garden-co',
      name: 'garden.co',
      status: 'active',
      sendingEnabled: true,
      routingEnabled: true,
      catchAllEnabled: true,
      checkedAtLabel: 'Checked 2 minutes ago',
    },
    {
      id: 'garden-team',
      name: 'garden.team',
      status: 'pending_verification',
      sendingEnabled: false,
      routingEnabled: true,
      catchAllEnabled: false,
      checkedAtLabel: 'Checked 12 minutes ago',
    },
  ],
  actors: [
    { type: 'member', id: 'seyi', name: 'Seyi', detail: 'Workspace owner' },
    { type: 'member', id: 'stone', name: 'Stone', detail: 'Administrator' },
    {
      type: 'agent',
      id: 'ir-agent',
      name: 'IR Agent',
      detail: 'Investor relations',
    },
    {
      type: 'agent',
      id: 'finance-agent',
      name: 'Finance Agent',
      detail: 'Finance operations',
    },
    {
      type: 'agent',
      id: 'legal-agent',
      name: 'Legal Agent',
      detail: 'Contract review',
    },
  ],
  mailboxes: [
    {
      id: 'investor-relations',
      domainId: 'garden-co',
      name: 'Investor Relations',
      kind: 'shared',
      status: 'active',
      primaryAddress: 'investors@garden.co',
      addresses: [
        {
          id: 'investors',
          address: 'investors@garden.co',
          kind: 'primary',
          status: 'active',
        },
        { id: 'ir', address: 'ir@garden.co', kind: 'alias', status: 'active' },
      ],
      access: [
        {
          id: 'access-seyi-ir',
          actor: {
            type: 'member',
            id: 'seyi',
            name: 'Seyi',
            detail: 'Workspace owner',
          },
          level: 'owner',
        },
        {
          id: 'access-ir-agent',
          actor: {
            type: 'agent',
            id: 'ir-agent',
            name: 'IR Agent',
            detail: 'Investor relations',
          },
          level: 'editor',
        },
      ],
    },
    {
      id: 'finance',
      domainId: 'garden-co',
      name: 'Finance',
      kind: 'agent',
      status: 'active',
      primaryAddress: 'finance@garden.co',
      addresses: [
        {
          id: 'finance-primary',
          address: 'finance@garden.co',
          kind: 'primary',
          status: 'active',
        },
        {
          id: 'billing',
          address: 'billing@garden.co',
          kind: 'alias',
          status: 'active',
        },
      ],
      access: [
        {
          id: 'access-finance-agent',
          actor: {
            type: 'agent',
            id: 'finance-agent',
            name: 'Finance Agent',
            detail: 'Finance operations',
          },
          level: 'owner',
        },
        {
          id: 'access-stone-finance',
          actor: {
            type: 'member',
            id: 'stone',
            name: 'Stone',
            detail: 'Administrator',
          },
          level: 'editor',
        },
      ],
    },
    {
      id: 'legal',
      domainId: 'garden-co',
      name: 'Legal',
      kind: 'shared',
      status: 'active',
      primaryAddress: 'legal@garden.co',
      addresses: [
        {
          id: 'legal-primary',
          address: 'legal@garden.co',
          kind: 'primary',
          status: 'active',
        },
      ],
      access: [
        {
          id: 'access-legal-agent',
          actor: {
            type: 'agent',
            id: 'legal-agent',
            name: 'Legal Agent',
            detail: 'Contract review',
          },
          level: 'editor',
        },
        {
          id: 'access-seyi-legal',
          actor: {
            type: 'member',
            id: 'seyi',
            name: 'Seyi',
            detail: 'Workspace owner',
          },
          level: 'owner',
        },
      ],
    },
  ],
  pendingAction: null,
  actions: {
    registerDomain: () =>
      fixtureCommand({ kind: 'domain_registered', domainId: 'design-domain' }),
    refreshDomain: (domainId) =>
      fixtureCommand({ kind: 'domain_refreshed', domainId }),
    createMailbox: () =>
      fixtureCommand({ kind: 'mailbox_created', mailboxId: 'design-mailbox' }),
    createAddress: () =>
      fixtureCommand({ kind: 'address_created', addressId: 'design-address' }),
    setAccess: () =>
      fixtureCommand({ kind: 'access_set', accessId: 'design-access' }),
    removeAccess: (accessId) =>
      fixtureCommand({ kind: 'access_removed', accessId }),
  },
}

export const setupMailSettingsController: ActiveMailSettingsController = {
  ...populatedMailSettingsController,
  domains: [],
  mailboxes: [],
}
