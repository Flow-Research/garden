# Think-Native Skills Architecture

## Overview

Garden used to treat skills as a runtime context refresh problem: a skill import/update persisted catalog data, bound agents, then asked every chat thread in the workspace to refresh its prompt/workspace skill inventory. That made a catalog write depend on historical thread runtime state.

Garden now treats R2 `SKILL.md` bundles as the runtime source of truth and Postgres as catalog/index/assignment state. Runtime agents expose those bundles through Think-native `SkillSource`s created by `createGardenSkillSources`, so Think can show the catalog and lazily call `activate_skill` / `read_skill_resource` when needed.

This document records the design decision and the old failure mode it replaced.

## Previous Behavior

The old import/update path was roughly:

```txt
/api/skills/import or /api/skills
  -> download or parse skill bundle
  -> write skill + skill_file rows
  -> write R2 files
  -> bind skill to workspace agents
  -> refresh every historical workspace thread runtime
      -> select all chat_thread rows in workspace
      -> for each thread with hostName:
           AgentDO asks the ChatSubAgent to refresh skills
             -> remove old custom skills context
             -> add old custom skills context provider
             -> refresh system prompt
             -> materialize every assigned skill into the thread workspace
```

This couples a successful skill write to every existing thread in the workspace.

## Problems

### 1. Import/update fans out to old runtime state

A skill import should be a catalog write. The old flow woke every historical chat thread so their prompts and workspaces could be updated immediately. That was slow and brittle.

### 2. One stale thread can fail the whole write

If one `AgentDO` RPC, sub-agent wake, workspace write, or prompt refresh failed, the user saw the import as failed even though DB/R2 writes may already have succeeded.

### 3. Work is repeated per thread

The agent skill inventory is agent/workspace-level data, but the old flow recomputed and materialized it per thread. In the observed workspace, one skill import tried to refresh 27 thread runtimes.

### 4. Context and files are too eager

The old path wrote all assigned skills into each thread workspace. Think’s shipped model is different: show a catalog first, then activate/read only the skill the task needs.

### 5. Runtime cache is treated as source of truth

The durable source of truth is Postgres/R2. Thread prompt/workspace state should be disposable cache. The old flow made cache updates part of the write transaction from the user’s point of view.

## What Think Ships

Installed `@cloudflare/think` now has first-class Agent Skills support:

- `Think.getSkills()`
- `skills.r2(bucket, { prefix })`
- `skills.fromManifest(...)`
- bundled `agents:skills` via the Agents Vite plugin
- model tools:
  - `activate_skill`
  - `read_skill_resource`
  - optional `run_skill_script`

Think docs state that skills are on-demand instructions, not always-on system prompt text. The model sees a catalog, then calls `activate_skill` when a user task matches a skill description.

That maps better to Garden than eager per-thread `load_context` refresh.

## Target Architecture

### Principle

Skill writes update catalog state. Runtime sessions observe catalog state lazily.

```txt
skill import/update
  -> persist catalog + files
  -> update agent assignment/version metadata
  -> return response

next agent turn / active runtime use
  -> read current assigned skills source
  -> Think exposes catalog
  -> model activates needed skill on demand
```

No skill write should need to wake every old chat thread.

## Proposed Components

### Workspace skill library

Represents skills available in a workspace.

Current tables can remain conceptually valid:

- `skill`
- `skill_file`

The library owns import metadata, frontmatter, description, bundle hash, source URL, and R2 object keys.

### Agent skill assignment

Represents which workspace skills a specific agent may use.

Current table:

- `agent_skill`

Long term, assignment changes should update a cheap version/hash for that agent, not refresh thread runtimes.

### Think SkillSource adapter

Garden needs a Think-compatible skill source backed by Postgres/R2 or by generated R2 manifests.

Two possible shapes:

#### Option A: DB/R2-backed `SkillSource`

Create a source that lists assigned skills for the current agent and reads resource bytes from R2.

Pros:
- direct source of truth
- no extra manifest generation path
- assignment filters naturally by agent

Cons:
- depends on `SkillSource` API stability
- runtime calls DB when listing/loading skills

#### Option B: generated R2 manifest per agent

On skill/assignment writes, generate a compact manifest under an agent-specific prefix, then use `skills.r2(...)` or `skills.fromManifest(...)`.

Pros:
- closer to shipped Think source types
- fast runtime reads
- avoids runtime DB queries for catalog list/load

Cons:
- manifest generation becomes another write artifact
- must keep manifest and DB in sync

Recommended starting point: Option A if `agents/skills` exports a stable source interface that Garden can implement. Otherwise use Option B.

### Runtime session behavior

Chat/issue/automation Think agents should expose skills via `getSkills()` instead of `Session.withContext("skills")`.

Sketch:

```ts
class ChatSubAgent extends Think<AgentRuntimeEnv> {
  getSkills() {
    return [
      gardenAgentSkillSource({
        databaseUrl: this.env.DATABASE_URL,
        files: this.env.FILES,
        agentRuntimeName: this.getAgentRuntimeName(),
      }),
    ]
  }
}
```

The model sees the skill catalog and calls `activate_skill` when needed. Supporting files are read through `read_skill_resource` instead of being prewritten into every thread workspace.

## Versioning and Cache Invalidation

If Garden keeps any runtime-side cache, it should be versioned.

Potential fields:

```txt
agent.skill_inventory_version
chat_thread.skill_inventory_version_seen
```

On skill import/update/assignment change:

```txt
update DB/R2
bump affected agent.skill_inventory_version
return
```

On next runtime use:

```txt
if thread.skill_inventory_version_seen !== agent.skill_inventory_version:
  refresh in-memory catalog/cache before turn
  update thread.skill_inventory_version_seen
```

This is optional if Think skill sources always read fresh enough state, but it is useful if Garden caches manifests or catalog summaries.

## Active Chats

Active chats should not require global fanout.

Acceptable UX:

- after import: UI updates skill library immediately
- active chat may show “New skills available. Next message will use them.”
- next message/turn observes new skills

Do not mutate a currently running turn’s skill set. Skill changes apply to the next turn.

## Error Boundaries

### Skill write errors

These should fail the API response:

- invalid skills.sh reference
- skills.sh download failure
- invalid bundle shape
- DB write failure
- R2 write/delete failure
- assignment/version write failure

### Runtime sync errors

These should not happen during import/update. They happen when a runtime tries to use skills.

Runtime errors should log:

- workspaceId
- agentId / hostName
- threadId or runId
- skill inventory version/hash
- skill name/resource path if applicable
- original cause/stack

If a user sends a message and skill sync fails, block that turn with a clear runtime error. Do not silently continue with stale skill state unless the product explicitly says stale skills are acceptable.

## Implementation Status

Completed current shape:

- routes log opaque API failures instead of surfacing only generic `HTTPError`
- skill writers persist canonical `SKILL.md` bundles to R2
- Postgres stores catalog/index/assignment state and parsed JSON frontmatter, not raw YAML
- `createGardenSkillSources` returns Think-native R2 `SkillSource`s
- `ChatSubAgent`, `IssueRunSubAgent`, and `AutomationRunSubAgent` expose skills through `getSkills()`
- import/update paths no longer depend on refreshing historical thread prompts or materializing skills into every thread workspace

Runtime errors should now be isolated to the turn/run trying to use a skill source. They should not make catalog writes fail after DB/R2 persistence succeeds.

## Open Questions

1. Should built-in document skills remain always available, or become assigned skills like everything else?
2. Do skill changes apply to all existing chats, or only new turns after the change?
3. Should inactive historical chats ever show the old skill catalog for reproducibility, or always use the latest agent assignment?
4. How should skill script execution be gated if Garden enables `run_skill_script` later?

## Recommendation

Garden has adopted Think-native Agent Skills as the long-term architecture. Garden’s DB/R2 skill library is the catalog source, not per-thread prompt context. Skill import/update persists catalog data and assignment metadata only. Runtime sessions list and activate skills on demand through Think’s `getSkills()` flow.

This removes the refresh bottleneck, aligns Garden with upstream Think, and keeps runtime skill state as lazy cache instead of a write-path dependency.
