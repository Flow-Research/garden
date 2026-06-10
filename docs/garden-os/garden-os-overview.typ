// Garden — system overview
// Prose-led, with bullets only where the content is genuinely a list.
// Bold emphasis on named primitives and trust levels.
// Visual language follows docs/vibe.md and docs/core/design.md.

#set document(title: "Garden", author: "Garden")

// ─── Vibe palette ────────────────────────────────────────────────────────────

#let parchment = rgb("#f5f3eb")
#let ink       = rgb("#1d2521")
#let gravel    = rgb("#7c766a")
#let slate     = rgb("#a39e90")
#let brand     = rgb("#4a8e5b")
#let hairline  = rgb(29, 37, 33, 45)

#set page(
  paper: "us-letter",
  margin: (top: 0.9in, bottom: 0.95in, left: 1.05in, right: 1.05in),
  fill: parchment,
  numbering: none,
  footer: context [
    #set text(font: "Liberation Sans", size: 8pt, fill: slate, tracking: 1.5pt)
    #grid(columns: (1fr, auto, 1fr),
      align: (left, center, right),
      upper[Garden],
      [#counter(page).display() · #counter(page).final().first()],
      upper[System overview]
    )
  ],
)

#set text(font: "Liberation Sans", size: 11.2pt, fill: ink)
#set par(leading: 1.05em, justify: false, first-line-indent: 0pt, spacing: 1.5em)

#show strong: it => text(weight: "bold", fill: ink, it.body)

// ─── Screenshot helper ──────────────────────────────────────────────────────
// Hairline-framed screenshot with an italic caption underneath. Keeps the
// editorial-restraint tone matching the cover and body.
#let shot(path, caption) = block(spacing: 1.6em)[
  #box(stroke: 0.4pt + hairline, inset: 0pt, radius: 2pt)[
    #image(path, width: 100%)
  ]
  #v(0.45em)
  #text(font: "Libertinus Serif", size: 9.5pt, fill: gravel, style: "italic")[
    #caption
  ]
]

#show heading.where(level: 2): it => block(
  above: 2.4em, below: 0.9em,
  text(font: "Libertinus Serif", size: 22pt, weight: "regular", tracking: -0.4pt, fill: ink, it.body)
)
#show heading.where(level: 3): it => block(
  above: 1.6em, below: 0.6em,
  text(size: 9pt, font: "Liberation Sans", weight: "medium", tracking: 2.5pt, fill: gravel, upper(it.body))
)

#show link: set text(fill: brand)

// ─── Native list, brand marker, proper hanging indent ───────────────────────
#set list(
  marker: text(fill: brand, weight: "bold", size: 1em)[•],
  indent: 0em,
  body-indent: 0.75em,
  spacing: 1.1em,
)

// ─── Cover page ─────────────────────────────────────────────────────────────
// Full-bleed atmospheric greenfield image fills the upper band of the page.
// Title sits in the negative-space sky; subtitle anchors the lower band.
// Cover uses zero-margin page; body resumes default margins after pagebreak.

#page(margin: 0pt, fill: parchment, footer: none)[
  // Image fills the upper portion of the page; clean parchment band at the
  // bottom holds the single tagline.
  #place(top + left, image("cover.png", width: 100%, height: 82%, fit: "cover"))

  // Tagline pinned near the bottom-right edge
  #place(bottom + right, dx: -0.95in, dy: -0.6in)[
    #text(font: "Libertinus Serif", size: 16pt, fill: ink, tracking: -0.1pt)[
      Garden, a company operating system for human and AI work
    ]
  ]
]

// ─── Overview eyebrow + rule ────────────────────────────────────────────────

#block(spacing: 0pt)[
  #text(font: "Liberation Sans", size: 9pt, weight: "medium", tracking: 3pt, fill: gravel)[
    OVERVIEW
  ]
]
#v(0.4em)
#line(length: 100%, stroke: 0.5pt + hairline)
#v(0.9em)

// ─── Lede ────────────────────────────────────────────────────────────────────

Garden is the workspace where a company's human work and its AI work
live on the same primitives. Every workspace runs a roster of
*persistent agents* alongside the team. The agents have their own
access to the tools the organisation uses (Gmail, Drive, Slack,
GitHub, Jira) and pick up work on the same issues, chats, and
documents the humans do. Skills and memory compound across the workspace, so
one person's process becomes shared baseline for every agent on the
team.

In practice, you join a workspace, the agents are already there, you
connect the workspace's tools, and the agents start taking on real
work alongside the team: drafting replies, summarising threads,
handling support tickets, triaging the inbox, opening and reviewing
pull requests, running scheduled reports, hiring specialists for
bounded work. Everything happens inside *one tabbed workspace*.
Inbox, issues, chats, skills, connections, and settings open side
by side. Nothing page-switches.

The product holds itself to one rule: *raise the floor without lowering
the ceiling*. A non-technical user gets rails to the same place a power
user can reach. There is no basic mode and no advanced mode. When one
person on a team figures out how to do something well, the capability
propagates: skills, memory, and agent configs compound across the
workspace. The product is the enablement, not a workshop.

== The surface

*Agents* are persistent coworkers that live in the workspace. They
know the workspace's tools, ongoing work, and shared memory. The
*inbox* is
one triage queue for approvals, mentions, blockers, and failed runs.
*Issues* are the generic work item, assignable to a person or an
agent, with a live activity card on the detail view. *Chats* are
persistent threads with your agent that resume cleanly. *Automations*
run scheduled or event-driven routines on their own execution path,
separate from issues. *Artifacts* unify documents, work products, and
sandbox outputs under one runtime model.

#v(0.5em)
#shot("screenshots/tasks-kanban.png")[
  The Tasks tab. The shell holds inbox, tasks, agents, library, and
  connections side by side; each card carries its priority, the
  assignee glyph (human or agent), and its column status.
]

== Hiring and delegation

The agents in a workspace can hire more agents. When the team needs
a new specialty (a dedicated QA reviewer, a research analyst, a
sales-ops agent), an existing agent can create a fresh persistent
agent in the workspace, configure its name, instructions, skills,
and connector access, and add it to the roster. The new agent gets
its own runtime, its own memory, and its own seat in the workspace.
It is a colleague the team gains, not a session that disappears.

For bounded units of work, an agent does not hire a new colleague.
It spins up an ephemeral *sub-agent* scoped to one piece of work (a
chat thread, an issue run, an automation run, a QA sweep), with the
skills and connectors that job needs. The sub-agent runs in its own
context, so a long-running specialist does not crowd out an open
chat. When the work is done, the run persists as a durable record
and the sub-agent is reclaimed. The agent itself is reused across
every job; only the sub-agents are ephemeral.

== Capability and trust

Capability is built on open standards, not on a proprietary
integration layer.

*Skills teach the agent to do new work.* A skill is a `SKILL.md` plus
an optional file bundle. It is a piece of process the agent picks up
and runs whenever the conditions match. One person on the team writes a
skill for, say, security auditing, brand-board generation, QA sweeps,
defragmenting a codebase, technical writing, or producing client
handoff PDFs, and from that moment any agent in the workspace can do
that work. The library grows with the team; a non-technical user
benefits from skills authored by their power-user teammates without
ever opening the editor. Skills follow the
#link("https://agentskills.io")[Agent Skills] spec used by Claude
Code, Cursor, Codex, Copilot, and roughly thirty other tools, so the
library travels with the workspace, not with the vendor. Author here,
run anywhere; author there, import here.

*Connectors give the agent reach.* Each connector speaks MCP and
defines its tools, OAuth or API-key flow, and a risk class per tool.
The five first-party connectors (Gmail, Google Drive, Slack, GitHub,
Exa Search) ship in the repo as references; anything else that speaks
MCP plugs in. A `create-garden-connector` CLI scaffolds a new one in
minutes against the typed connector SDK. The catalog is meant to grow
without core changes.

Permissions are set per-agent and per-connector at three levels:

- *Ask always.* The agent asks before every use. Default for new
  connectors.
- *Ask on risky.* The agent proceeds on reads. It asks on writes,
  sends, and external actions. This is the steady-state default.
- *Never ask.* Full autonomy. Reserved for trusted, low-risk,
  high-volume capabilities.

When a gate fires, the agent posts an approval to the inbox. One click
runs the action and optionally upgrades trust for next time. No silent
failures. No stack traces in the user's surface.

#v(0.5em)
#shot("screenshots/connections.png")[
  Connections, with the per-tool trust matrix. Each tool a connector
  exposes is set to Auto, Allow, or Ask, scoped per agent.
]

== What it can do today

Beyond drafting and triage, the agent already reaches well outside the
chat window:

- *Browser use.* Cloudflare Browser Run gives the agent a real browser
  it can drive. It can visit a deployed URL, fill a form, click through
  a flow, and capture what it saw.
- *Sandboxes with shareable preview URLs.* The agent can spin up a
  service inside a sandbox and get a real, public URL back that a
  teammate can open in their browser. The thing the agent builds is
  something a human can immediately click around in.
- *GitHub depth.* Read code, search repos, comment on issues, open
  issues, and draft pull requests, all through the typed GitHub
  connector with its own permission tier.
- *Document artifacts.* The agent authors, edits, and reviews real
  documents through the artifact runtime, with tracked changes
  preserved end to end.

These are composed by the *typed automation registry*. An automation
template declares the capabilities it needs (browser, sandbox, GitHub),
the skills it requires, the inputs it accepts, and the output contract
it returns. Schedules run on timezone-aware cron through a dedicated
trigger Durable Object. The first built-in is the *QA Sweep*: the
agent discovers a feature surface on its own, performs static review,
drives the browser when a URL is available, drafts generated tests for
approval, validates evidence for false greens, and closes with a
structured report. It can optionally open a Garden issue, a GitHub
issue, a draft PR, or update a QA artifact. Adding another automation
is a new template definition, not a runtime change.

#v(0.5em)
#shot("screenshots/issue-detail.png")[
  An issue with the agent's draft work product attached. The Brief
  artifact lands in Review beside the original request, ready for a
  teammate to read.
]

#v(0.4em)
#shot("screenshots/issue-chat.png")[
  The same run from inside chat. The agent's task trail collapses
  into completed steps as the work moves through read, run, and
  comment.
]

== Architecture

The whole stack runs on Cloudflare end to end, and the reason matters.
"Every workspace runs a roster of persistent agents" only works if
each agent costs roughly nothing while idle. The product leans on
three primitives:

- *Durable Object.* A small server with its own attached storage and
  a single, addressable identity. Garden runs one per agent. Memory,
  chat history, and local task state live in the object's SQLite.
  When the agent is idle the object hibernates and costs nothing;
  when work comes in it wakes with state intact. This is what makes
  a roster of persistent agents per workspace a real unit economic
  instead of a slogan.
- *Workflow.* Cloudflare's primitive for code that needs to retry,
  wait, resume, or cancel across hours or days without losing state.
  Long-running agent runs sit inside Workflows. There is one durable
  execution boundary in the system, not a custom recovery layer per
  long-running concern.
- *Sandbox.* An isolated container the agent spins up on demand to
  run code: scripts, data transforms, a one-off cleanup, even a small
  web app it just wrote. Output streams back into chat. If the code
  runs a server, the agent gets a real public URL back that any
  teammate can open in their browser to see and use the thing.

Supporting services fill in around those three. *Postgres* is the
control plane: workspaces, users, issues, skills, connectors,
permission grants, and the audit log. Per-agent state stays in the
Durable Object, not here. *Realtime* is the Agents SDK WebSocket
layered on Durable Object broadcast, keeping every open tab in sync
under half a second. *Connectors* run as typed MCP tools behind a
Cloudflare Workers proxy, with first-party adapters for Gmail, Google
Drive, Slack, GitHub, and Exa Search. *R2* holds files and skill
bundles.

== Where it's going

=== Shipping now

- Workspaces with owner / admin / member roles. A roster of
  persistent agents per workspace.
- All the tabbed surfaces: inbox, issues, chats, agent detail, skill
  editor, connections, automations, settings.
- Five first-party connectors (Gmail, Google Drive, Slack, GitHub,
  Exa Search) with typed permissions and an audit row on every call.
- Live activity streaming on issue pages. Task plans rendered inline
  on the run card.
- Automations on a dedicated execution path with a typed template
  registry, output contracts, and timezone-aware cron scheduling.
- Document artifacts converging on a single runtime model. Sandboxes
  spinning up on demand, each with a public URL a teammate can open.

=== Next

- *Memory synthesis* across the workspace. Per-agent memory exists in
  each Durable Object; the synthesis layer turns it into shared
  baseline behind consent gates.
- *Headless modes.* A Slack-native assistant that operates inside
  Slack threads, plus API-only and scheduled-script entry points so
  the agent can run outside the web shell.
- *Multi-pane workspace.* Two tabs side by side, so the inbox and an
  issue (or a chat and a document) can sit open together.

=== Later

- Knowledge graph spanning the workspace's connected tools.
- Native desktop shell.
- Enterprise SSO and finer-grained RBAC.
