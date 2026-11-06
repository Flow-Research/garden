---
title: Load skills on demand through Think instead of refreshing every thread
description: Decision record from June 2026 to make R2 skill bundles the runtime source and expose them through Think skill sources, replacing per-thread skill refresh.
status: decision
owner: "@Umoren"
last_reviewed: 2026-11-03
---

**Date:** June 2026. **Outcome:** adopted. The current behavior is described in [skills](../concepts/features/skills.md).

## Context

Garden treated skills as a problem of refreshing runtime context. A skill import or update wrote the catalog, bound the skill to agents, and then asked every chat thread in the workspace to refresh its prompt and its copy of the skill files. The old path ran like this:

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
             -> add new custom skills context provider
             -> refresh system prompt
             -> materialize every assigned skill into the thread workspace
```

That coupling caused five problems:

1. **A catalog write fanned out to old runtime state.** Every historical thread woke so its prompt and workspace could update. In one observed workspace, a single import tried to refresh 27 thread runtimes.
2. **One stale thread could fail the whole write.** If one `AgentDO` call, facet wake, workspace write, or prompt refresh failed, the user saw the import fail, even though the database and R2 writes had already succeeded.
3. **Work repeated per thread.** The skill inventory belongs to the agent and workspace, but the old path recomputed and copied it for each thread.
4. **Context and files were too eager.** Every assigned skill was written into every thread workspace. Think's model is the opposite: show a catalog, then load only the skill the task needs.
5. **A cache acted as the source of truth.** Postgres and R2 were durable. Thread prompts and workspaces were cache, yet the write path waited on them.

## Decision

Garden adopted Think's native Agent Skills. R2 `SKILL.md` bundles became the runtime source of truth. Postgres became the catalog, index, and assignment store. Each Think agent returns its sources from `getSkills()`, and the model calls `activate_skill` and `read_skill_resource` on demand. A skill write persists the catalog and returns. Runtime sessions read the current state lazily on their next turn.

## Alternatives considered

Two shapes were weighed for the skill source:

- **A database- and R2-backed `SkillSource`.** It lists the agent's assigned skills and reads bundle bytes from R2. It reads the source of truth directly and filters by assignment without an extra build step. It depends on the `SkillSource` interface staying stable and queries the database at runtime.
- **A generated R2 manifest per agent.** Each write would generate a manifest under an agent prefix for `skills.r2(...)` or `skills.fromManifest(...)`. Runtime reads would be fast and need no database query. But the manifest would become one more artifact to keep in sync with the database.

The first shape won because `agents/skills` exports a stable source interface. The shipped design wraps the SDK `r2` source and filters it by the agent's assignments.

A versioned cache, with fields such as `agent.skill_inventory_version`, was also sketched. It was not built, because the skill source reads fresh assignments and its fingerprint changes when they do.

## Consequences

- Skill writes no longer touch existing threads.
- Write errors and runtime errors fail in different places. A write fails the API response. A runtime failure is isolated to the turn that used the skill.
- Skill changes apply from the next turn. A running turn keeps its skill set.
- API routes log opaque failures instead of returning only a generic `HTTPError`.
