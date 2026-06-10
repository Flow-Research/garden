# Code Context

## Files Retrieved
1. `package.json` (lines 6-22) - root scripts show Turbo entry points and dev filters.
2. `turbo.json` (lines 25-56) - task graph; `transit` sits between validation tasks and dependency graph.
3. `pnpm-workspace.yaml` (lines 1-8) - workspace package locality: `apps/*`, `connectors`, `workers/*`, `packages/*`.
4. `apps/web/package.json` (lines 8-47) - web app owns build/dev and depends on every Garden package.
5. `packages/core/package.json` (lines 12-63) - broad public export surface mixing domain, server, client, platform, hooks.
6. `packages/db/package.json` (lines 20-37) - DB scripts/exports; Drizzle schema and validation package seam.
7. `packages/agent-runtime/package.json` (lines 13-38) - runtime package dependency breadth: Cloudflare runtime, AI, DB, core, connectors, document libs.
8. `connectors/package.json` (lines 12-24) - connector package public entries.
9. `packages/ui/package.json` (lines 13-24) - UI export surface: atomic components, common components, markdown, hooks.
10. `packages/core/auth/index.ts` (lines 1-39) - shallow singleton registration wrapper around auth store.
11. `packages/core/workspace/index.ts` (lines 1-38) - same singleton wrapper pattern for workspace store.
12. `packages/core/issues/server.ts` (lines 1-120) - core issue service imports Drizzle, DB validation, run wakeups, and runtime start.
13. `packages/core/issues/run-service.ts` (lines 1-130) - issue run service owns DB, Workflow, AgentDO adapter shape, run outcomes.
14. `packages/core/automations/run-service.ts` (lines 1-135) - automation run service mirrors issue run adapter shape.
15. `apps/web/src/lib/server/automations.ts` (lines 1-120, 500-640) - web-side automation API/scheduling service imports core runtime service and adds DB/concurrency/schedule behavior.
16. `connectors/sdk.ts` (lines 1-56) - connector spec is mostly data shape plus `defineConnector` identity helper.
17. `connectors/registry.ts` (lines 1-27) - registry is static connector list and lookup map.
18. `connectors/capabilities.ts` (lines 1-69) - shared permission/risk helpers used across web and MCP proxy.
19. `apps/web/src/lib/server/capability-sync.ts` (lines 252-390) - web sync adapts connector registry to MCP transport and DB capabilities.
20. `workers/mcp-proxy/src/permission.ts` (lines 1-145) - proxy authorization consumes persisted capability rows and connector risk types.
21. `packages/db/src/validation/index.ts` (lines 1-100, 136-220) - DB-backed Zod schemas are centralized for several records.
22. `apps/web/src/lib/server/validation/issues.ts` (lines 1-105) - API-facing issue validation wraps DB validation and maps API names.
23. `apps/web/src/lib/server/validation/automations.ts` (lines 1-115) - automation API validation duplicates value enums and leaves config JSON as unknown.
24. `packages/db/src/schema/index.ts` (lines 1-12) - schema barrel is pure pass-through export.
25. `packages/db/src/schema/automations.ts` (lines 32-115) - automation table has many JSON config fields and check constraints.
26. `packages/agent-runtime/src/index.ts` (lines 1-41) - runtime barrel exports Durable Objects, Workflow, prompt, document, skill helpers.
27. `apps/web/src/server.ts` (lines 1-55) - web Worker imports and re-exports runtime Durable Objects and Workflow.
28. `packages/agent-runtime/src/agent-do.ts` (lines 1-100) - AgentDO module has product/runtime architecture comments and many infrastructure imports.
29. `packages/agent-runtime/src/documents/document-tools.ts` (lines 1-105) - document utility/tool module blends DB, workspace FS, docx generation, and document storage.
30. `packages/ui/components/common/actor-avatar.tsx` (lines 1-58) - reusable UI base component.
31. `apps/web/src/features/common/actor-avatar.tsx` (lines 1-30) - app adapter wrapper injects workspace actor lookup.
32. `packages/ui/markdown/Markdown.tsx` (lines 1-110) - reusable markdown base with hooks for mention/CDN behavior.
33. `apps/web/src/features/common/markdown.tsx` (lines 1-46) - app adapter wrapper injects issue mentions and config.

## Key Code

### Candidate 1 - Turborepo graph is shallow around `transit`

`turbo.json` defines a `transit` task and makes validation tasks depend on it:

```json
// turbo.json lines 25-52
"tasks": {
  "transit": { "dependsOn": ["^transit"] },
  "build": { "dependsOn": ["^build"] },
  "dev": { "cache": false, "persistent": true, "interactive": true },
  "typecheck": { "dependsOn": ["transit"] },
  "test": { "dependsOn": ["transit"] },
  "lint": { "dependsOn": ["transit"] }
}
```

Search evidence: `rg '"transit"' --glob package.json` found no package scripts named `transit`. Most packages have `typecheck`, `lint`, and `test`, but no `build` either (`packages/core/package.json` lines 6-10, `packages/agent-runtime/package.json` lines 7-12, `connectors/package.json` lines 6-10). Web owns an actual `build` task (`apps/web/package.json` lines 8-23). The task graph therefore looks like an Interface but has little Depth: validation depends on a named Module that currently has no package-local behavior.

Deletion test: deleting or renaming the `transit` task likely changes little unless hidden Turbo semantics rely on a missing script. It is a candidate for either deeper task leverage or removal as accidental seam. No implementation proposed.

### Candidate 2 - `@garden/core` is a high-leverage but wide mixed Module

`@garden/core` exports many unrelated seams from one package: types, auth/workspace stores, server services, run services, React hooks/providers, realtime, observability, platform RPC, and utility modules (`packages/core/package.json` lines 12-52). It also depends on DB, connectors, React Query, Zustand, Zod, and Drizzle (`packages/core/package.json` lines 54-63).

Two shallow pass-through/singleton Modules show one side of the package:

```ts
// packages/core/auth/index.ts lines 1-23
export { createAuthStore } from './store'
export type { AuthStoreOptions, AuthState } from './store'
let _store: AuthStoreInstance | null = null
export function registerAuthStore(store: AuthStoreInstance) { _store = store }
export const useAuthStore: AuthStoreInstance = new Proxy(...)
```

```ts
// packages/core/workspace/index.ts lines 1-22
export * from './store'
let _store: WorkspaceStoreInstance | null = null
export function registerWorkspaceStore(store: WorkspaceStoreInstance) { _store = store }
export const useWorkspaceStore: WorkspaceStoreInstance = new Proxy(...)
```

The other side is server/runtime logic:

```ts
// packages/core/issues/server.ts lines 1-25
import { drizzle } from 'drizzle-orm/neon-serverless'
import * as schema from '@garden/db/schema'
import { issueCommentInsertSchema, issueInsertSchema, ... } from '@garden/db/validation'
import { startIssueRun, type IssueRunEnv } from './run-service'
```

Search evidence: web imports `@garden/core/types` 74 times, `@garden/core/workspace` 32 times, `@garden/core/hooks` 31 times, `@garden/core/auth` 22 times, and many other subpaths. `packages/agent-runtime` imports core observability, issue run sync, connector errors, agent permissions, issue server/run-service, and types. This is strong Leverage but weak Locality: one package is both client app state Adapter and server/domain Adapter.

Deletion test: deleting `@garden/core` is impossible because too many consumers cross the Seam. Deleting individual subpaths may reveal accidental shallow Modules (`auth`, `workspace`, several `index.ts` barrels) versus deeper product Modules (`issues/run-service`, `observability/logger`). Candidate is to deepen or clarify package seams, not to invent a concrete Interface.

### Candidate 3 - Run orchestration is split across core, web, and agent runtime

Issue and automation run services both model Workflow and AgentDO bindings inside `@garden/core`:

```ts
// packages/core/issues/run-service.ts lines 19-78
const WORKFLOW_START_FAILURE_RETRY_DELAY_MS = 5_000
const AGENT_RUNTIME_NAME_PATTERN = /^[A-Za-z0-9._:-]+$/
type RunWorkflowBinding = { get: (id: string) => Promise<{ sendEvent: (...) => Promise<void> }> }
export type IssueRunEnv = { DATABASE_URL: string; RUN_WORKFLOW?: RunWorkflowBinding; AgentDO?: { idFromName: ...; get: ... } }
```

```ts
// packages/core/automations/run-service.ts lines 6-30
const AGENT_RUNTIME_NAME_PATTERN = /^[A-Za-z0-9._:-]+$/
type RunWorkflowBinding = { get: (id: string) => Promise<{ sendEvent: (...) => Promise<void> }> }
export type AutomationRunEnv = { DATABASE_URL: string; RUN_WORKFLOW?: RunWorkflowBinding; AgentDO?: { idFromName: ...; get: ... } }
```

Web adds API/schedule/concurrency behavior around the core automation service:

```ts
// apps/web/src/lib/server/automations.ts lines 1-9
import { cancelAutomationRun, startAutomationRun } from '@garden/core/automations/run-service'
import { getDb, schema } from '@/lib/server/db'
import type { AppEnv } from '@/lib/server/env'
```

```ts
// apps/web/src/lib/server/automations.ts lines 505-640
async function applyDispatchConcurrency(...) { ... }
export async function dispatchAutomation(...) {
  const startResult = await startAutomationRun(input.env, { ...contextSnapshot... })
}
```

Agent runtime is the concrete runtime Adapter that web imports and re-exports from the Worker entry:

```ts
// apps/web/src/server.ts lines 3-45
import { AgentDO, AutomationRunSubAgent, AutomationTriggerDO, ChatSubAgent, IssueRunSubAgent, RunWorkflow } from '@garden/agent-runtime'
export { AgentDO }
export { AutomationRunSubAgent }
export { AutomationTriggerDO }
export { ChatSubAgent }
export { IssueRunSubAgent }
export { RunWorkflow }
```

This Seam has real Depth: durable execution, DB rows, API dispatch, scheduling, and agent runtime all meet here. Evidence of shallowness/risk is duplicated binding shape, duplicated runtime-name validation, and web/core split of automation run state transitions. Deletion test: delete `apps/web/src/lib/server/automations.ts` and core still has runtime starts but loses schedule/concurrency/API surface; delete `@garden/core/automations/run-service` and web loses runtime dispatch. Candidate area is run orchestration Locality and Adapter boundaries.

### Candidate 4 - Connectors are data-local, behavior is spread through web and MCP proxy

The connector package provides a compact data spec:

```ts
// connectors/sdk.ts lines 1-56
export type RiskClass = 'read' | 'write' | 'send_external' | 'destructive'
export type ConnectorSpec = ...
export function defineConnector(spec: ConnectorSpec): ConnectorSpec { return spec }
```

Registry is a static list and map:

```ts
// connectors/registry.ts lines 8-24
export const connectorRegistry = [exaSearchConnector, githubConnector, gmailConnector, googleDriveConnector, slackConnector]
export const connectorsById = new Map(connectorRegistry.map((connector) => [connector.id, connector]))
export function getConnectorById(id: string) { return connectorsById.get(id) }
```

Some connector policy helpers live with the registry (`connectors/capabilities.ts` lines 16-69), but the high-depth behavior lives elsewhere. Web sync uses the connector spec to build MCP transport, list tools, classify tools, and persist capability rows:

```ts
// apps/web/src/lib/server/capability-sync.ts lines 310-339
const connector = getConnectorById(args.connectorId)
const classification = connector?.tools[args.tool.name]
if (!connector || !classification) return Result.err(...unclassified_tool...)
return Result.ok({ connectorType, name, schemaHash, requiredScopes, riskClass })
```

MCP proxy permission then uses persisted capability rows plus connector risk types:

```ts
// workers/mcp-proxy/src/permission.ts lines 28-47
export type PermissionDecision =
  | { kind: 'allow'; capabilityId: string; riskClass: RiskClass; trustLevel: ... }
  | { kind: 'needs-approval'; capabilityId: string; riskClass: RiskClass; requestId: string; ... }
  | { kind: 'reauth-required'; capabilityId: string; riskClass: RiskClass; missingScopes: string[] }
```

Deletion test: deleting a connector spec breaks sync classification; deleting synced DB capability rows breaks proxy authorization even though registry data still exists. This is a good deepening opportunity because Leverage is high (web UI, proxy auth, runtime MCP tools), but Locality is split across data spec, sync Adapter, and permission Adapter.

### Candidate 5 - DB schema validation is shared, API validation is app-local and uneven

`@garden/db` exports schema and validation (`packages/db/package.json` lines 30-36). Its validation module uses Drizzle-derived schemas:

```ts
// packages/db/src/validation/index.ts lines 1-32
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { account, agent, chatThread, invitation, issue, issueComment, ... } from '../schema/index.js'
export const uuidSchema = z.string().uuid()
export const jsonObjectSchema = z.record(z.string(), z.unknown())
```

Issue API validation reuses DB schemas and maps API field names:

```ts
// apps/web/src/lib/server/validation/issues.ts lines 1-24
import { issueInsertSchema, issueSourceBindingInsertSchema, issuePrioritySchema, issueStatusSchema, issueUpdateSchema, uuidSchema } from '@garden/db/validation'
const issueApiAssigneeTypeSchema = z.enum(['member', 'agent'])
const issueDueDateApiSchema = z.union([datetimeStringSchema, issueInsertSchema.shape.dueDate])
```

Automation API validation pulls enum values from schema files, but leaves many product config blobs as `z.unknown()`:

```ts
// apps/web/src/lib/server/validation/automations.ts lines 47-69
export const createAutomationBodySchema = z.object({
  title: nonEmptyStringSchema,
  assignee_agent_id: uuidSchema,
  input_schema: z.unknown().optional().nullable(),
  context_sources: z.unknown().optional().nullable(),
  output_config: z.unknown().optional().nullable(),
  execution_config: z.unknown().optional().nullable(),
  notification_config: z.unknown().optional().nullable(),
  scheduling_config: z.unknown().optional().nullable(),
})
```

The table schema also stores those values as JSON (`packages/db/src/schema/automations.ts` lines 62-73). This is a Seam between persistent shape, API shape, and product/domain shape. Deletion test: removing DB validation would force app validators to duplicate schema details; removing app validators would lose API naming and request parsing behavior. Candidate area: validation Locality and Depth around DB-backed versus product-config data. Do not infer a concrete Interface from this scout.

### Candidate 6 - UI package has useful base Modules plus shallow app Adapters

`@garden/ui` exports atoms, common components, markdown, hooks, utils, and styles (`packages/ui/package.json` lines 13-24). Web imports `@garden/ui/lib/utils` heavily and many component subpaths. There are 48 app-local `apps/web/src/components/ai-elements/*.tsx` files, while `packages/ui/components/common` has 9 shared common components.

The ActorAvatar seam is a clean base-plus-app Adapter:

```tsx
// packages/ui/components/common/actor-avatar.tsx lines 7-13
interface ActorAvatarProps { name: string; initials: string; avatarUrl?: string | null; isAgent?: boolean; size?: number; className?: string }
```

```tsx
// apps/web/src/features/common/actor-avatar.tsx lines 3-29
import { ActorAvatar as ActorAvatarBase } from '@garden/ui/components/common/actor-avatar'
import { useActorName } from '@/lib/workspace/hooks'
export function ActorAvatar({ actorType, actorId, ... }) {
  const { getActorName, getActorInitials, getActorAvatarUrl } = useActorName()
  return <ActorAvatarBase name={...} initials={...} avatarUrl={...} isAgent={actorType === 'agent'} />
}
```

Markdown repeats the same pattern:

```tsx
// packages/ui/markdown/Markdown.tsx lines 30-60
export interface MarkdownProps { children: string; mode?: RenderMode; onUrlClick?: ...; onFileClick?: ...; renderMention?: ...; cdnDomain?: string }
```

```tsx
// apps/web/src/features/common/markdown.tsx lines 33-45
export function Markdown(props: MarkdownProps) {
  const cdnDomain = useConfigStore((s) => s.cdnDomain)
  return <MarkdownBase renderMention={defaultRenderMention} cdnDomain={cdnDomain} {...props} />
}
```

Deletion test: many web features can use UI atoms directly, but app-local adapters encode product Locality. The candidate is deciding which wrappers are useful Depth versus pass-through churn. The `ai-elements` folder is app-local despite generic-sounding names; that may be intentional product Locality or a missed shared-code Leverage point.

## Architecture

Workspace shape is simple: root scripts invoke Turbo; pnpm workspaces split into `apps/web`, `workers/*`, `connectors`, and `packages/*`. Web is the composition root: it depends on every Garden package (`apps/web/package.json` lines 42-47), exports Durable Objects from `@garden/agent-runtime` in the Worker entry, and owns most request/API/server-function code under `apps/web/src/lib/server`.

`@garden/db` is the persistence Module. It exports Drizzle schema, validation, client, and testing helpers. `@garden/core` sits above DB and below web/runtime: it holds shared domain types, issue/automation services, client stores, hooks/providers, observability, and platform helpers. `@garden/agent-runtime` sits beside web as the concrete Cloudflare/AI runtime Module; web imports and re-exports it for Worker bindings. `connectors` is a data/spec Module used by web capability sync, MCP proxy permission, and agent runtime MCP setup. `@garden/ui` is a shared presentation Module with app-specific Adapters in `apps/web/src/features/common`.

Main Seams found:

- Package/task Seam: Turbo graph vs packages that mostly run TypeScript directly with no build/transit outputs.
- Domain/service Seam: `@garden/core` as shared domain plus client state plus server runtime orchestration.
- Runtime Adapter Seam: core run services speak minimal `Env` shapes; web and agent-runtime supply Cloudflare bindings and concrete DO/Workflow behavior.
- Connector Adapter Seam: static connector registry is separate from sync-time MCP discovery and proxy-time authorization.
- Validation Seam: DB-derived Zod schemas are shared, but API request schemas and product config validation live in web.
- UI Adapter Seam: shared base components are wrapped by app-local product adapters.

Risks/open questions:

- Does Turbo `transit` intentionally reserve a future generated-artifacts step, or is it dead graph surface?
- Should `@garden/core` be treated as the domain Module despite React/Zustand exports, or is it an aggregation package with several sub-Modules?
- Are automation config JSON fields intentionally loose while product shape is still moving, or should typed leverage already exist elsewhere? I did not find a central automation config contract in the files read.
- Are app-local `ai-elements` meant to be product-specific Garden UI, or borrowed/generic components waiting for shared locality?

## Start Here

Start with `packages/core/package.json` (lines 12-63) and `turbo.json` (lines 25-56). Together they show the largest architectural pressure: broad shared package surface and shallow task graph. From there, open `packages/core/automations/run-service.ts` plus `apps/web/src/lib/server/automations.ts` to inspect the deepest seam with clear evidence across package boundaries.
