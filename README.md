# Garden

An operating system where humans and AI agents work side by side.

You sign up, get a persistent personal agent, connect your tools (Gmail, Google Drive, Slack, GitHub, search), and your agent starts picking up work — drafting emails, triaging issues, writing summaries, running reports. You stay in the loop through a single tabbed workspace: inbox, issues, chat, agent config, and skills all open as tabs in one surface.

> **Raise the floor, don't lower the ceiling.** Non-technical users get a product that just works. Power users get the full capability surface. Nothing is dumbed down.

---

## Why Garden

AI models are extraordinary. The harness around them is broken.

Power users build elaborate personal setups — MCP servers, custom prompts, CLI tools, scheduled scripts — and get 10x. Everyone else watches and asks how. Training doesn't fix it. Workshops don't fix it. Workflows discovered by one person stay with that person.

Garden fixes this. Inspired by [Ramp's Glass](https://x.com/sebgoddijn/status/2042285915435937816) (99% internal adoption, built for every function — finance, ops, marketing, not just eng), we're building the product version of that system. Every employee gets an AI-powered operating surface. One person's breakthrough becomes everyone's baseline.

### Who it's for

**Primary:** Non-technical roles at small-to-mid companies (10–500 employees) — CEOs, ops, finance, marketing, sales, customer support.

**Secondary:** Developers on the same teams. Garden doesn't replace Claude Code or Cursor — it's where agent-authored PRs come back to, where GitHub issues live alongside human work, and where non-dev teammates operate.

---

## Core concepts

### Your agent — a digital twin

Every user gets a persistent personal agent created at signup. It knows your tools, your context, your active work, and your preferences. It acts as a paired coworker — not a chatbot, not a fleet you manage.

Your agent can delegate to specialists for bounded work, but the primary experience is you and your agent working together.

### Skills — reusable capability modules

Garden adopts the [Agent Skills open standard](https://agentskills.io) from Anthropic (used by Claude Code, Cursor, Codex, Copilot, and ~30 others). A skill is a `SKILL.md` (YAML frontmatter + markdown) plus optional bundled files. Skills are workspace-scoped, Postgres-versioned, and edited in-app.

When one user writes a great skill, every agent in the workspace can use it.

### Connections & permissions

Connections today include **Gmail**, **Google Drive**, **Slack**, **GitHub**, and **Discord**. Exa powers Garden's first-party web-search tool rather than masquerading as a user connection. Connector tools have per-agent permissions at three trust levels:

- **Ask always** — agent asks before every action
- **Ask on risky** — agent proceeds on reads, asks on writes/sends
- **Never ask** — full autonomy for trusted, high-volume operations

When an agent needs approval, it posts to your inbox. Approve, and optionally upgrade trust for next time.

### The tabbed workspace

Everything is a tab — inbox, issue detail, chat session, agent config, skill editor, settings. No page switching, no mode confusion. Tabs persist across reloads, hidden tabs keep React state alive.

FlexLayout tab styling notes live in [docs/core/flexlayout-tabs.md](docs/core/flexlayout-tabs.md).

A Glass-style two-level sidebar on the left: icon rail for context switching (`HOME`, `CHATS`, `AGENT`, `SKILLS`, `CONNECTIONS`, `SETTINGS`) and a collapsible explorer panel beside it.

---

## Architecture

```
Browser ──── TanStack Start (CF Workers/Pages) ────── Postgres (control plane)
   │                    │
   │                    ├── Better Auth session
   │                    └── API / server routes
   │
   └── WebSocket ─── Agent Durable Object (per user)
                         │
                         ├── DO SQLite (per-agent state)
                         ├── CF Agents SDK (LLM calls, tool routing)
                         ├── Executor MCP session DO ─── integrations
                         ├── native GitHub / Discord tools
                         └── CF Sandbox (spun up for code tasks)
```

### Why Cloudflare

- **Hibernation economics.** Durable Objects cost zero when idle. A persistent agent per user is economically viable — 100M agents at modest concurrency is ~100 active instances, not millions of containers.
- **One stack.** Agents (DOs + SDK), code execution (Sandboxes), frontend (Pages/Workers), storage (R2). No stitching Modal + E2B + Vercel + Supabase + a queue.
- **Actor model fits agents.** Per-agent SQLite means each agent's memory and state lives with it. No shared DB for agent state, no distributed locks, no job queue.
- **All GA.** Sandboxes, DOs, Agents SDK — shipped and production-ready.

---

## Tech stack

| Layer            | Technology                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Frontend         | [TanStack Start](https://tanstack.com/start) (React 19) + [TanStack Router](https://tanstack.com/router) (file-based routing) |
| UI               | [shadcn](https://ui.shadcn.com) `base-nova` + Base UI                                                                         |
| Styling          | Tailwind CSS v4 (CSS-first, no config file)                                                                                   |
| State            | Zustand (client) + TanStack Query (server)                                                                                    |
| Editor           | TipTap (issues, skills, comments)                                                                                             |
| Auth             | [Better Auth](https://www.better-auth.com) (email code + Google OAuth)                                                        |
| Agent runtime    | [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) on Durable Objects                                         |
| Code execution   | [Cloudflare Sandboxes](https://developers.cloudflare.com/sandbox/)                                                            |
| Control plane DB | Postgres ([Neon](https://neon.tech)) via [Drizzle ORM](https://orm.drizzle.team)                                              |
| Per-agent state  | Durable Object SQLite                                                                                                         |
| Realtime         | CF Agents SDK WebSocket + DO broadcast                                                                                        |
| File storage     | Cloudflare R2                                                                                                                 |
| Email            | Resend (transactional)                                                                                                        |
| Error handling   | [better-result](https://github.com/nicobrinkkemper/better-result) (no try/catch)                                              |
| Linting          | oxlint + oxfmt                                                                                                                |
| Testing          | Vitest                                                                                                                        |
| Monorepo         | Turborepo + pnpm workspaces                                                                                                   |

---

## Project structure

```
garden/
├── apps/
│   └── web/                    # TanStack Start web app
│       ├── src/
│       │   ├── routes/         # File-based routing
│       │   ├── features/       # Feature modules (auth, chat, inbox, issues, skills, ...)
│       │   ├── components/     # Shared app components
│       │   ├── lib/            # Utilities
│       │   └── hooks/          # App-level hooks
│       ├── vite.config.ts
│       └── wrangler.jsonc      # CF Worker config
├── packages/
│   ├── core/                   # Shared logic & hooks (api, auth, chat, issues, realtime, ...)
│   ├── ui/                     # Design system (shadcn components, tokens, styles)
│   ├── agent-runtime/          # CF Agents SDK runtime
│   ├── connectors/             # Native connectors + provider policy metadata
│   ├── db/                     # Postgres schema (Drizzle) + migrations
│   ├── env/                    # Environment config
│   └── tsconfig/               # Shared TypeScript config
├── docs/
│   └── core/                   # PRD, technical docs, design system docs
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) (v22.12+)
- [pnpm](https://pnpm.io) (v10.33.0)
- A Postgres database ([Neon](https://neon.tech) recommended)
- Docker Desktop or Docker Engine if you want local Cloudflare Sandbox/container execution
- Cloudflare Wrangler auth when you need to manage deployed Worker resources

### Setup

```bash
# Clone
git clone https://github.com/Flow-Research/garden.git && cd garden

# Install dependencies
pnpm install

# Configure local environment
cp .env.example .env
# Edit root .env with this repo's shared local development values:
#   CLOUDFLARE_ACCOUNT_ID=<your Cloudflare account>
#   DATABASE_URL=postgresql://...
#   BETTER_AUTH_SECRET=<generate a random secret>
#   EXECUTOR_SECRET_KEY=<generate a persistent random secret>
#   BETTER_AUTH_URL=http://localhost:3000
#   ENVIRONMENT=development
#
#   Optional, connector-specific:
#   GitHub / Google / Slack keys if you use those connectors
#
# The app should not boot cleanly without the required values.
# Web, database tooling, and local scripts all read root .env.
# Deployed Workers continue to use Cloudflare secrets and bindings.

# Run database migrations
pnpm --filter @garden/db db:migrate

# Start the Garden Worker through Turbo's TUI
pnpm dev
```

Open `http://localhost:3000`.

`pnpm dev` is the normal local workflow:

- Turbo starts `@garden/web` in TUI mode.
- The web app runs on `localhost:3000`.
- Garden Worker and Cloudflare remote bindings use values from root `.env`.

OAuth callbacks are configured for `localhost:3000` in local env and Wrangler config.

### Commands

| Command                               | Description                                                        |
| ------------------------------------- | ------------------------------------------------------------------ |
| `pnpm dev`                            | Start the web Worker with remote bindings and containers           |
| `pnpm dev:local`                      | Start the web Worker with local bindings                           |
| `pnpm dev:reset`                      | Stop Garden dev processes started by Turbo/Vite/Wrangler           |
| `pnpm dev:web`                        | Start only the web app with full bindings                          |
| `pnpm --filter @garden/web dev:local` | Start only the web app directly on `localhost` with local bindings |
| `pnpm build`                          | Build all packages                                                 |
| `pnpm typecheck`                      | Type-check everything                                              |
| `pnpm lint`                           | Lint with oxlint                                                   |
| `pnpm format:write`                   | Format with oxfmt                                                  |
| `pnpm test`                           | Run all tests                                                      |
| `pnpm clean`                          | Clean build artifacts                                              |

**Database:**

| Command                                | Description                            |
| -------------------------------------- | -------------------------------------- |
| `pnpm --filter @garden/db db:generate` | Generate migration from schema changes |
| `pnpm --filter @garden/db db:migrate`  | Apply migrations                       |
| `pnpm --filter @garden/db db:check`    | Check migration consistency            |
| `pnpm --filter @garden/db db:sync`     | Run Drizzle sync helpers               |

---

## Operating principles

1. **Don't limit anyone's upside.** Non-tech users get rails, but the rails carry them to the same ceiling. No "basic" vs "advanced" mode. One product.
2. **One person's breakthrough becomes everyone's baseline.** Skills, memory, and agent configs compound across the workspace.
3. **The product is the enablement.** No training workshops. The product teaches by doing — suggesting skills at the right moment, surfacing successful patterns, self-healing connector errors.

---

## MVP scope

**In scope:** Multi-user workspaces, personal agent per user, agent delegation, generic issue primitive, Agent Skills spec, Gmail + Google Drive + Slack + GitHub + search connectors, tabbed workspace surface, per-agent permissions, live agent activity streaming, basic audit log.

**Out of scope:** Knowledge graph, skill marketplace, native desktop/mobile apps, enterprise SSO, wide connector catalog. See [`docs/core/DEFERRED.md`](docs/core/DEFERRED.md).

---

## Documentation

| Document                                                               | Description                                               |
| ---------------------------------------------------------------------- | --------------------------------------------------------- |
| [`docs/core/PRD.md`](docs/core/PRD.md)                                 | Full product requirements                                 |
| [`docs/core/technical.md`](docs/core/technical.md)                     | Architecture deep-dive                                    |
| [`docs/core/design.md`](docs/core/design.md)                           | Design system & UX patterns                               |
| [`docs/core/connectors.md`](docs/core/connectors.md)                   | Connector model, contribution rules, and review checklist |
| [`docs/core/realtime-foundation.md`](docs/core/realtime-foundation.md) | Real-time sync patterns                                   |
| [`docs/core/chat-runtime-model.md`](docs/core/chat-runtime-model.md)   | Chat & runtime model                                      |
| [`docs/core/DEFERRED.md`](docs/core/DEFERRED.md)                       | Deferred features & non-goals                             |

## Contributing connectors

Connector contributions follow [`docs/core/connectors.md`](docs/core/connectors.md). It is the source of truth for official-upstream-only policy, manifest review rules, and capability classification requirements.

General contribution guidance is in [CONTRIBUTING.md](CONTRIBUTING.md).
Report vulnerabilities privately through [SECURITY.md](SECURITY.md).

---

## License

Garden is licensed under the [GNU Affero General Public License v3.0 only](LICENSE).

If you modify Garden and let users interact with the modified version over a
network, AGPLv3 requires offering those users the corresponding source. Bundled
third-party components remain under their respective licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
