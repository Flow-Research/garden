# Garden documentation

Read this page before you change Garden. Documentation is part of feature work. It records the agreed behavior, boundaries, and design rules that you need to know before you edit code.

Code and tests define what exists today. If a document disagrees with them, trust the code and tests, then fix the document in the same pull request.

The same files render as the handbook at `/handbook` in the Garden app for any signed-in user. Page text ships in the app's public JavaScript, so never put secrets or credentials in `docs/`.

## Find the right folder

The folders follow [Diátaxis](https://diataxis.fr). Each page has one job.

| Folder | Holds | Example |
| --- | --- | --- |
| [`tutorials/`](./tutorials/get-started.md) | A guided first run you follow start to finish | [Get started](./tutorials/get-started.md) |
| [`guides/`](./guides/develop/ship-a-change.mdx) | Steps for one task you already understand | [Write a migration](./guides/develop/write-a-migration.md) |
| [`concepts/`](./concepts/architecture/how-garden-is-built.mdx) | Why a part of Garden works the way it does | [Run engine](./concepts/architecture/run-engine.md) |
| [`reference/`](./reference/architecture-map.md) | Facts to look up: paths, bindings, tokens, gaps | [Environment and bindings](./reference/environment-and-bindings.md) |
| [`decisions/`](./decisions/) | Dated design decisions and their trade-offs | [Scoped Executor MCP sessions](./decisions/2026-10-scoped-executor-mcp-sessions.md) |
| [`proposals/`](./proposals/) | Designs that are not built yet | [Decide in automations](./proposals/decide-automations.md) |
| [`archive/`](./archive/) | Historical snapshots. Not current truth. | Past audits and specs |

`templates/` holds the feature page template. It is not a site page.

## Read the smallest set that answers your question

Read in this order, and stop when you have what you need:

1. Read the repository rules in [`AGENTS.md`](../AGENTS.md) and the contribution skill at [`.agents/skills/contribute/SKILL.md`](../.agents/skills/contribute/SKILL.md).
2. Read the feature page in [`concepts/features/`](./concepts/features/) for the area you are changing.
3. Read the architecture page in [`concepts/architecture/`](./concepts/architecture/how-garden-is-built.mdx) and find code with the [architecture map](./reference/architecture-map.md).
4. For UI work, read [design direction](./concepts/design/design-direction.md) and [design tokens](./reference/design-tokens.md).
5. Before you change scope or release behavior, read the [roadmap](./concepts/product/roadmap.md) and [known gaps](./reference/known-gaps.md).
6. Before you change a user flow, read the verification map at [`.agents/skills/verify/features/README.md`](../.agents/skills/verify/features/README.md).

| Question | Read |
| --- | --- |
| What is Garden building now? | [Roadmap](./concepts/product/roadmap.md), [Product](./concepts/product/product.md) |
| What must web and native clients share? | [Client scope and boundary proposal](./proposals/cross-platform-clients.md), [HTTP API](./concepts/architecture/http-api.md) |
| Where does this behavior live? | [Architecture map](./reference/architecture-map.md) |
| How do runs, tools, and permissions work? | [Run engine](./concepts/architecture/run-engine.md), [Connectors](./concepts/architecture/connectors.md), [Agent runtime](./concepts/architecture/agent-runtime.md), [Permissions](./concepts/features/permissions.md) |
| What must not be claimed yet? | [Known gaps](./reference/known-gaps.md) |
| How do I prove the change? | [`.agents/skills/verify/SKILL.md`](../.agents/skills/verify/SKILL.md) |

## Documentation is part of done

For a new feature, add or update a page in `docs/concepts/features/` in the same pull request as the code. Start from [`templates/feature.md`](./templates/feature.md) and follow [Write a feature doc](./guides/develop/write-a-feature-doc.md).

For a bug fix or refactor, update the nearest page when the change affects behavior, a design rule, an ownership boundary, or an operational procedure. If it affects none of those, say so in the pull request.

For an architecture or infrastructure change, add a dated record in `docs/decisions/` and update the concept page it changes.

Every page carries `title`, `description`, `status`, `owner`, and `last_reviewed` frontmatter. `pnpm verify:docs` checks frontmatter, links, and repository paths, and it fails a `current` page that has gone 90 days without review.
