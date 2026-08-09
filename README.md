# Garden

Garden is an open-source workspace for people and AI agents. It brings chat,
tasks, automations, skills, connected tools, documents, and approvals into one
tabbed app, so a team can see what its agents are doing and decide what they are
allowed to do.

> Garden is under active development and is preparing for a small-user beta.
> Read the [roadmap](docs/roadmap.md) and
> [known gaps](docs/known-gaps/README.md) before using it in production.

## What Garden does

- Gives each workspace a persistent agent that can chat, work through tasks,
  and run scheduled automations.
- Keeps human and agent work together instead of hiding agent activity in a
  separate console.
- Connects external tools while keeping permissions and approvals visible.
- Supports reusable [Agent Skills](https://agentskills.io) that belong to the
  workspace rather than one person's laptop.
- Opens chats, tasks, agents, skills, connections, inbox items, and automations
  in a persistent tabbed workspace.

Garden is built for cross-functional teams at small and mid-sized companies.
Developers use the same workspace to inspect agent work, build integrations and
skills, and keep technical work tied to shared tasks.

## Run Garden locally

The normal development setup keeps the web app and Cloudflare's local D1, R2,
Durable Object, and Workflow simulators on your machine. It connects to your
Postgres database and uses Cloudflare's remote Workers AI binding. Docker is
not required to start this mode.

### Prerequisites

- [Node.js](https://nodejs.org) 22.12 or newer
- pnpm 10.33.0; Corepack is the simplest way to install the pinned version
- A Postgres database; [Neon](https://neon.tech) is the setup used by the
  runtime
- A Cloudflare account for Workers AI
- Docker only when running the full test suite or Sandbox-container mode

### 1. Clone and install

```bash
git clone https://github.com/Flow-Research/garden.git
cd garden

corepack enable
corepack install
pnpm install --frozen-lockfile
```

The repository pins pnpm 10.33.0 through the `packageManager` field in
`package.json`.

### 2. Sign in to Cloudflare

```bash
pnpm --filter @garden/web exec wrangler login
pnpm --filter @garden/web exec wrangler whoami
```

Copy the Account ID reported by `wrangler whoami`; it becomes
`CLOUDFLARE_ACCOUNT_ID` in the next step.

### 3. Configure the environment

```bash
cp .env.example .env
```

Fill in these required values in the root `.env` file:

| Variable                | What to use                                                   |
| ----------------------- | ------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID from `wrangler whoami`                              |
| `DATABASE_URL`          | Connection string for a dedicated Postgres database           |
| `BETTER_AUTH_SECRET`    | A high-entropy secret of at least 32 characters                |
| `EXECUTOR_SECRET_KEY`   | A second, separate high-entropy secret for connector execution |

Generate the two secrets separately; do not reuse one value:

```bash
openssl rand -base64 32
```

`BETTER_AUTH_URL=http://localhost:3000` and `ENVIRONMENT=development` already
have local defaults in `.env.example`. PostHog values are optional locally but
required for deployment. Connector credentials are needed only for the
providers you choose to configure.

### 4. Migrate and start

```bash
pnpm --filter @garden/db db:migrate
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), create an account, then
create a workspace. Use that signup-to-workspace flow as a manual first-run
check; Garden does not yet expose a dedicated health endpoint.

`pnpm dev` starts:

- the TanStack Start app on port 3000;
- local D1, R2, Durable Object, and Workflow state through the Workers
  simulator;
- Hyperdrive pointed at `DATABASE_URL`; and
- the remote Workers AI binding, which may incur usage on your Cloudflare
  account.

### Troubleshooting

**Workers AI fails to start:** run `wrangler whoami` again and check that
`CLOUDFLARE_ACCOUNT_ID` in `.env` belongs to the authenticated account.

**Database migrations fail:** confirm the database exists, the connection
string includes any connection options required by your provider, and the user
can create and alter tables. Then rerun
`pnpm --filter @garden/db db:migrate`.

**A connector is unavailable:** provider credentials are optional. Add only the
matching variables from `.env.example`, then restart the development process.

**The full test suite cannot start Postgres:** start Docker first. Database
tests use Testcontainers and pull `postgres:16-alpine` on the first run.

**Port 3000 is already in use:** stop the process that owns the port. The
`pnpm dev:reset` helper uses broad process-name matching on macOS and Linux and
may stop unrelated Vite, Workerd, or esbuild processes, so use it deliberately.

### Sandbox-container mode

`pnpm dev:containers` enables Cloudflare Sandbox containers. Core application
state still runs locally and Workers AI remains remote. This mode requires
Docker:

```bash
pnpm dev:containers
```

The tracked `apps/web/wrangler.containers.jsonc` works without account-specific
resource IDs. An ignored `apps/web/wrangler.containers.local.jsonc` can override
it when you deliberately need different bindings; never commit real account
IDs or credentials.

## Product tour

### Personal agents and shared work

Creating a workspace creates its default Garden agent. Chats, task runs, and
automation runs keep their own runtime context, while work and results remain
visible to the team. Garden can hand specific tasks to specialist agents while
keeping the main workspace simple.

### Connections and permissions

Garden has native GitHub and Discord integrations and an Executor-backed
catalog for other providers. Catalog entries still need the relevant provider
credentials and setup before an agent can use them.

![Garden connections catalog with personal and workspace tabs](docs/assets/readme/connections.webp)

_The development catalog. Provider availability depends on local credentials
and runtime configuration._

Each connector tool has a risk class: `read`, `write`, `send_external`, or
`destructive`. Per-agent grants use three trust levels:

- `auto` is available for read-only tools that may run without pausing;
- `allow` lets the tool proceed and records the action in the audit trail; and
- `ask` pauses and sends an approval request to Garden's inbox.

Unknown tools fail closed instead of inheriting a permissive default.

### Skills

Garden supports the [Agent Skills](https://agentskills.io) format: a
`SKILL.md` file plus optional bundled resources. Skills belong to a workspace,
keep version history, and can be assigned to agents.

### Documents and artifacts

Agents and people work against the same document state. Uploaded DOCX files are
converted into versioned document blocks, edited inside Garden, and exported
back to DOCX or PDF.

![Garden document editor showing a saved DOCX after an underline edit](docs/assets/open-source-ui/document-editor-after.png)

_An imported DOCX edited and saved through Garden's document workspace._

## Architecture

```text
Browser ─── TanStack Start Worker ─── Neon Postgres (shared product data)
   │                  │
   │                  ├── Better Auth and server routes
   │                  ├── D1 and R2
   │                  └── Cloudflare Workflows
   │
   └── WebSocket ─── Agent Durable Object
                         │
                         ├── per-agent SQLite state
                         ├── Cloudflare Agents + Think runtime
                         ├── Executor integration session ─── providers
                         └── Cloudflare Sandbox for container tasks
```

Garden is Cloudflare-first. TanStack Start runs in a Worker, Durable Objects
host agent and Model Context Protocol (MCP) sessions, Workflows manage
long-running task and automation runs, and R2 stores files. Neon Postgres is the
source of truth for shared product data.

### Tech stack

| Layer                  | Technology                                                        |
| ---------------------- | ----------------------------------------------------------------- |
| Web app                | TanStack Start, React 19, TanStack Router                          |
| UI                     | Base UI, shadcn, Tailwind CSS v4                                   |
| Authentication         | Better Auth                                                        |
| Agent runtime          | Cloudflare Agents, Think, Durable Objects, Workflows               |
| Integration runtime    | Executor MCP plus Garden-native GitHub and Discord tools           |
| Code execution         | Cloudflare Sandbox and isolated JavaScript execution                |
| Shared database        | Neon Postgres with Drizzle ORM                                     |
| Agent and runtime data | Durable Object SQLite, D1, and R2                                  |
| Testing                | Vitest and Testcontainers                                          |
| Monorepo               | pnpm workspaces and Turborepo                                      |

For the deeper runtime model, read
[`docs/core/technical.md`](docs/core/technical.md).

## Repository map

```text
garden/
├── apps/web/                 # TanStack Start application and Worker entry
├── packages/agent-runtime/   # agents, workflows, tools, and execution
├── packages/app-state/       # client-side application state
├── packages/connectors/      # native integrations and provider policy
├── packages/core/            # shared product types and services
├── packages/db/              # Drizzle schema, migrations, and test helpers
├── packages/env/             # environment validation
├── packages/observability/   # logs, analytics, and error reporting
├── packages/server/          # shared server-side services
├── packages/ui/              # design system and reusable UI
├── workers/tail-observer/    # optional Worker log summaries
└── docs/                     # architecture, product, and operating notes
```

## Common commands

| Command                  | Purpose                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `pnpm dev`               | Start the normal local app with remote Workers AI              |
| `pnpm dev:containers`    | Add Docker-backed Sandbox containers to the local app          |
| `pnpm lint`              | Run oxlint across the workspace                                |
| `pnpm typecheck`         | Generate Worker types and type-check the workspace             |
| `pnpm test`              | Run tests; Docker is required for database suites              |
| `pnpm build`             | Build the production application                               |
| `pnpm format`            | Check formatting                                               |
| `pnpm format:write`      | Apply the repository formatter                                 |
| `pnpm verify:connectors` | Check connector catalog and provider-policy coverage           |

Database commands:

| Command                                | Purpose                                |
| -------------------------------------- | -------------------------------------- |
| `pnpm --filter @garden/db db:generate` | Generate a migration from schema edits |
| `pnpm --filter @garden/db db:migrate`  | Apply pending migrations               |
| `pnpm --filter @garden/db db:check`    | Check migration consistency            |

## Project status

The current focus is a dependable small-user beta: workspace isolation, run
recovery, connector reliability, smoke coverage, and trustworthy approval and
audit paths. The [roadmap](docs/roadmap.md) tracks beta work, and the
[known-gaps index](docs/known-gaps/README.md) records unfinished or deferred
areas.

On-premises and fully self-hosted operation are not current capabilities. See
[`docs/core/DEFERRED.md`](docs/core/DEFERRED.md) for deliberate non-goals and
later work.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Connector contributions have two
paths—Executor-hosted integrations and Garden-native adapters—described in
[`docs/core/connectors.md`](docs/core/connectors.md).

Keep pull requests focused, include tests for behavior changes, and run the
checks that CI will run before asking for review. Report vulnerabilities
privately through [SECURITY.md](SECURITY.md).

## Documentation

| Document                                                               | Covers                                      |
| ---------------------------------------------------------------------- | ------------------------------------------- |
| [`docs/roadmap.md`](docs/roadmap.md)                                   | Beta priorities and readiness checklist     |
| [`docs/known-gaps/README.md`](docs/known-gaps/README.md)               | Current gaps by product and runtime area     |
| [`docs/core/PRD.md`](docs/core/PRD.md)                                 | Product requirements                        |
| [`docs/core/technical.md`](docs/core/technical.md)                     | Architecture and current implementation     |
| [`docs/design.md`](docs/design.md)                                     | Design system and interaction principles    |
| [`docs/core/connectors.md`](docs/core/connectors.md)                   | Connector runtime and contribution paths    |
| [`docs/core/realtime-foundation.md`](docs/core/realtime-foundation.md) | Realtime and polling boundaries             |
| [`docs/core/chat-runtime-model.md`](docs/core/chat-runtime-model.md)   | Chat and agent runtime model                |
| [`docs/core/DEFERRED.md`](docs/core/DEFERRED.md)                       | Deferred features and explicit non-goals    |

## License

Garden is licensed under the
[GNU Affero General Public License v3.0 only](LICENSE). The AGPL includes
network-use source-sharing requirements; read the license before distributing
or operating a modified version. Bundled third-party components keep their own
licenses and notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
