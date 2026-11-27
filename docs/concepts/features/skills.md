---
title: Skills load on demand from R2 through Think skill sources
description: Where skills are stored, how an agent sees only its assigned skills, and why a skill write never touches existing chat threads.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-03
---

A skill is a `SKILL.md` bundle of instructions and supporting files that teaches an agent a task. Skills belong to a workspace and are assigned to agents. An agent sees a catalog of its assigned skills and loads one only when a task calls for it.

The reasons for this design, and the eager design it replaced, are in the decision record [Think-native skills](../../decisions/2026-06-think-native-skills.md).

## R2 holds the bundles and Postgres holds the catalog

The bundle files are the runtime source of truth. Skill writes store each workspace skill in the R2 `FILES` bucket under `agent-skills/workspaces/<workspaceId>/<slug>/`. `packages/agent-runtime/src/skill-storage-paths.ts` builds those keys. Built-in skills live under `builtin-skills/`.

Postgres holds the catalog, index, and assignments in `packages/db/src/schema/skills.ts`:

- `skill` stores the catalog entry and parsed frontmatter as JSON.
- `skill_version` stores versions of a skill.
- `skill_file` indexes the files in a bundle.
- `skill_assignment` records which agents may use which skills.

Imports and updates go through `apps/web/src/lib/server/skills-service.ts`. Imports from skills.sh go through `apps/web/src/lib/server/skills-sh.ts`.

## Agents read skills through `getSkills()`

Every Think agent in Garden overrides `getSkills()` and returns `loadRuntimeSkillSources(...)` from `packages/agent-runtime/src/skills.ts`. `ChatSubAgent` in `agent-do.ts` does this for chat. `RunSubAgentBase` in `run-sub-agent-base.ts` does it for issue and automation runs.

`loadRuntimeSkillSources` returns two Think `SkillSource`s, both built on the `r2` source from `agents/skills`:

1. A workspace source over the workspace prefix. It loads the agent's `skill_assignment` rows and filters `list`, `load`, and `readResource` to assigned skill names. Its fingerprint includes the assignment list, so Think notices when assignments change.
2. A built-in source over `builtin-skills/`. `filterBuiltinSkillSource` in `skills-filter.ts` limits it to the agent's `allowed_skills` unless the agent has `full_access`.

## The model activates a skill only when it needs it

Think shows the model the catalog of skill names and descriptions. When a task matches, the model calls `activate_skill` to load the instructions and `read_skill_resource` to read a supporting file. Nothing is written into the thread's workspace ahead of time, and skills are not part of the always-on system prompt.

## A skill write is a catalog write

Importing, updating, or assigning a skill writes Postgres and R2 and returns. It does not wake or refresh existing chat threads. The next turn in any thread reads the current assignments through its skill source. A change never alters a turn that is already running.

This splits errors cleanly:

- **Write errors fail the API response.** An invalid skills.sh reference, a failed download, an invalid bundle, or a failed database or R2 write each return an error to the caller.
- **Runtime errors stay with the turn.** A failed skill-source call raises `RuntimeSkillSourceError` inside the turn or run that used it. It never makes a successful catalog write look failed.

## Questions still open

- Should built-in document skills stay always available, or become assigned skills like the rest?
- Should an old chat show the skill catalog it had at the time, for reproducibility, or always the latest assignment?
- How should Garden gate skill scripts if it enables Think's `run_skill_script` later?
