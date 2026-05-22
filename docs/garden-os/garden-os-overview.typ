// Garden OS — three-page overview
// Audience: curious reader who wants to understand the system end to end.
// Style draws from docs/vibe.md and docs/core/design.md — parchment ground,
// light-weight serif display whispering against a precise sans body,
// single warm green accent, hairlines instead of hard rules.
// Philosophy is woven through prose, not labelled.

#set document(title: "Garden", author: "Garden")

// ─── Vibe palette ────────────────────────────────────────────────────────────
// Mapped from packages/ui tokens (oklch → rgb for print):
//   parchment  oklch(0.97 0.012 95)  ≈ #f5f3eb
//   ink        oklch(0.22 0.012 145) ≈ #1d2521  (green-tinted near-black)
//   gravel     oklch(0.50 0.010 90)  ≈ #7c766a  (warm stone, secondary text)
//   slate      oklch(0.65 0.008 95)  ≈ #a39e90  (tertiary)
//   brand      oklch(0.58 0.13 148)  ≈ #4a8e5b  (single accent)
//   hairline   ink @ 10%             ≈ rgb 29 37 33 alpha 26

#let parchment = rgb("#f5f3eb")
#let ink       = rgb("#1d2521")
#let gravel    = rgb("#7c766a")
#let slate     = rgb("#a39e90")
#let brand     = rgb("#4a8e5b")
#let hairline  = rgb(29, 37, 33, 50)

#set page(
  paper: "us-letter",
  margin: (top: 1.0in, bottom: 0.95in, left: 1.05in, right: 1.05in),
  fill: parchment,
  numbering: none,
  footer: context [
    #set text(font: "Liberation Sans", size: 8pt, fill: slate, tracking: 1.5pt)
    #grid(columns: (1fr, auto, 1fr),
      align: (left, center, right),
      upper[Garden],
      [#counter(page).display() · #counter(page).final().first()],
      upper[An operating surface]
    )
  ],
)

// Body: precise sans, tracking calmed for editorial feel
#set text(font: "Liberation Sans", size: 10.5pt, fill: ink, tracking: 0pt)
#set par(leading: 0.72em, justify: true, first-line-indent: 0pt, spacing: 1.15em)

// Display: light-weight serif (Garamond stands in for Fraunces 300)
#show heading: set text(font: "Garamond", weight: "regular")
#show heading.where(level: 1): it => block(
  above: 1.8em, below: 0.7em,
  text(size: 9pt, font: "Liberation Sans", tracking: 3pt, fill: gravel, upper(it.body))
)
#show heading.where(level: 2): it => block(
  above: 1.4em, below: 0.55em,
  text(size: 17pt, weight: "regular", tracking: -0.3pt, fill: ink, it.body)
)

#show link: set text(fill: brand)
#show link: underline.with(offset: 2pt, stroke: 0.4pt + brand)

// ─── Masthead ────────────────────────────────────────────────────────────────

#block(spacing: 0pt)[
  #text(font: "Liberation Sans", size: 8.5pt, tracking: 4pt, fill: ink)[GARDEN]
  #h(0.4em)
  #box(baseline: -1pt)[
    #circle(radius: 1.6pt, fill: brand)
  ]
  #h(1fr)
  #text(font: "Garamond", size: 10.5pt, style: "italic", fill: gravel)[
    A workshop for human and AI work
  ]
]
#v(0.2em)
#line(length: 100%, stroke: 0.4pt + hairline)
#v(0.7em)

// ─── Lede ────────────────────────────────────────────────────────────────────

#block(width: 100%, inset: (right: 0pt))[
  #text(font: "Garamond", size: 18pt, weight: "regular", fill: ink, tracking: -0.3pt)[
    Garden is a company operating system where humans and AI agents work side
    by side. You sign up, get a persistent personal agent, connect your tools,
    and the agent starts picking up work. You stay in the loop through a
    single tabbed workspace.
  ]
]

#v(0.4em)

// ─── Body ────────────────────────────────────────────────────────────────────

The premise is simple and the room around it is broken. AI models are
extraordinary; the harness around them is not. Inside tech-forward companies
a small group of power users wires up MCP servers, custom prompts, and
scheduled scripts, and pulls ahead by a factor of ten. Everyone else watches
and asks how. Outside tech-forward companies it is worse — a CEO at a
forty-person services firm wants AI to draft proposals and chase invoices and
has no realistic path to it that does not run through a terminal. Training
does not fix this. Workshops do not fix this. The workflows one person
discovers stay with that person.

Garden is the product version of the system Ramp built internally as Glass.
Glass reached ninety-nine percent adoption across every function — finance,
ops, marketing, support, not just engineering — and Ramp will not sell it,
because internal productivity is a moat. The same problem exists at every
non-Ramp company, and most cannot build Glass themselves. That is the wedge.
The bet is that every company needs an AI operating layer; the big companies
will build their own, and the mid-market and below will buy ours.

The product holds itself to two rules. The first is to raise the floor
without lowering the ceiling. A non-technical user gets rails, but the rails
carry them to the same place a power user can reach. There is no basic mode
and no advanced mode. Capability is invisible until it is needed and never
gated away. The second is that one person's breakthrough becomes everyone's
baseline. Skills, memory, and agent configurations compound across the
workspace. When somebody figures out how to do something well, the capability
propagates without a workshop. The product itself is the enablement — it
teaches by doing, surfaces the right skill at the right moment, self-heals
connector errors, and seeds onboarding with the user's real data instead of
a sandbox.

Practically, you sign up and your agent is already there. You connect Gmail,
Drive, Slack, and GitHub, and the agent starts triaging real work — drafting
replies, summarising threads, opening pull requests, filing issues, running
reports on a schedule. Approvals come back to your inbox as typed items;
denying or upgrading trust is one click. Conversations, documents, and the
issue board open as tabs in a single dense, keyboard-navigable shell — a
cultivated workshop, parchment-warm rather than dashboard-bright, closer to
Linear or VS Code than to any SaaS admin panel. You open Garden and stay in
it. You do not check it and leave.

== The shape of the system

The mental model is your agent, not a fleet. Every user has one persistent
personal agent — a digital-twin coworker, not a chatbot and not a roster to
manage. It knows your tools, your context, your active work, and your
preferences. When a piece of work is bounded and specialised it can delegate
to a sub-agent, but the centre of the product is the two of you working
together.

Capability is shared through the Agent Skills open standard, the same spec
that Claude Code, Cursor, Codex, Copilot, and roughly thirty other tools have
adopted. A skill is a `SKILL.md` file with YAML frontmatter plus an optional
file bundle. In Garden, skills are workspace-scoped, Postgres-versioned, and
edited in-app. A skill written here runs in those other tools; a skill
written there can be imported. There is no proprietary capability format
locking anyone in.

Connections to outside systems come through first-party connectors — Gmail,
Google Drive, Slack, GitHub, and Exa Search at launch — exposed as typed MCP
tools. Each tool carries a typed input, a typed output, and a risk class.
Permissions are per-agent and per-connector at three trust levels: ask
always, ask on risky, never ask. The right default for a new connector is
ask on risky — the agent proceeds on reads and asks on writes or external
sends — and trust upgrades from inbox approvals are one click. There are no
silent failures and no stack traces leaking into the user's surface.

== How it's built

The whole stack runs on Cloudflare end to end. There is no stitching of
Modal, E2B, Vercel, Supabase, and a queue together. The frontend is TanStack
Start on React 19 with file-based routing, shadcn `base-nova` on Base UI,
Tailwind v4 with CSS-first tokens, Zustand for client state, TanStack Query
for server state, and TipTap for the rich editor. The agent runtime is the
Cloudflare Agents SDK on Durable Objects — one actor per user, with the
agent's memory and chat history in its own SQLite — and Cloudflare Workflows
as the durable execution boundary for long-running runs (retries, waits,
resumes, cancels). Code execution is Cloudflare Sandboxes, spun up on demand
by the agent and exposed through quick-tunnel previews. The control plane is
Neon Postgres reached through Drizzle ORM, with shared Zod schemas via
`drizzle-zod`. Better Auth handles email-code and Google OAuth. Realtime is
the Agents SDK WebSocket layered on Durable Object broadcast for
per-workspace and per-issue subscriptions. R2 stores files; Resend sends
transactional email. Errors are handled through `better-result` — there are
no `try` / `catch` blocks in the codebase. Turborepo and pnpm workspaces
orchestrate the monorepo.

The choice of Cloudflare is what makes the rest possible. Durable Objects
hibernate to zero cost when idle, which is what turns "every employee gets a
persistent agent" from an aspirational line on a slide into a real unit
economic. A hundred million agents at realistic concurrency is closer to a
hundred live instances than to a million containers. The actor model also
fits the shape of an agent: per-agent SQLite means each agent's memory and
state live with it, with no shared agent database, no distributed locks,
and no separate job queue grafted on. Workflows is the single
retry-and-resume boundary, so the codebase has one place to reason about
durable execution instead of a custom recovery layer for every long-running
concern.

Everything visible in the product is a tab in one shell. Inbox, issues, chat
sessions, the agent workspace, the skill editor, connections, and settings
all open as tabs side by side. Tabs persist across reloads; hidden tabs keep
their React state alive. The left edge is a two-level sidebar — an icon rail
for context switching, a collapsible explorer panel beside it — sitting on a
warm parchment ground with atmospheric washes drifting at the corners and
vellum panels floating over them. Depth comes from blur and overlap, not
from drop shadows. A single warm green carries status, focus, and brand;
everything else is ink and gravel. The default agent surface is the personal
agent: an overview, an activity stream, the instruction bundle, the attached
skills, the connected tools, the permission matrix, the run history, and the
agent's memory.

== Where it's going

The MVP surface is in place. A new user can sign up, connect Gmail, Slack,
and GitHub, and have their agent draft a reply within ten minutes.
Teammates in the same workspace see each other's issues and agent activity,
subject to permissions. A user can author a new skill, attach it to their
agent, and watch the agent use it. A denied capability turns into an inbox
approval and resumes cleanly after the user signs off. Live issue pages
update in well under half a second when the agent posts. Automations
recently moved off the issue runner onto a dedicated execution path with a
typed registry for templates and output contracts. Document, work-product,
and sandbox artifacts are converging on a single runtime model.

The near-term roadmap fills in what the MVP deferred. Queue, task, and
sandbox surfaces — already prepared as AI Elements components — wire into
the agent interaction panel so users can see what is queued, watch sub-tasks
complete, and preview sandbox output inline in chat. Scheduled automations
land on top of the new registry, so a user can cron a routine without
touching the issue surface. Memory synthesis stitches per-agent memory into
shared workspace baseline, with consent gates. An in-flow skill recommender
surfaces the right skill at the moment it would help, instead of leaving
discovery to a menu. Headless modes — Slack-native assistants, scheduled
scripts, API-only flows — let the agent operate outside the web shell when
that is the better fit.

Further out, a knowledge graph spans the workspace's connected tools, so
the agent can reason across email, documents, and code without re-asking
the user. A skill marketplace opens cross-workspace sharing for the
open-standard skills. A multi-pane workspace lets users put two tabs side
by side. Native desktop and mobile shells follow the web. Enterprise SSO
and finer-grained RBAC unlock the move from mid-market into the larger end
of the same motion. The shape of the product does not change; the surface
area widens.

#v(0.4em)
#line(length: 100%, stroke: 0.4pt + hairline)
#v(0.5em)

#block[
  #grid(columns: (auto, 1fr),
    column-gutter: 0.8em,
    align: (left + horizon, left + horizon),
    box(baseline: -1pt, circle(radius: 1.8pt, fill: brand)),
    text(font: "Garamond", size: 11pt, style: "italic", fill: gravel, tracking: 0.1pt)[
      Every company needs an AI operating layer. Big companies will build
      their own. Mid-market and below will buy Garden.
    ]
  )
]
