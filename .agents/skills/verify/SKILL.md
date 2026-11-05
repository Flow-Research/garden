---
name: verify
description: Verify Garden changes through the local stack and real user paths. Use for MVP, Decide, UI, connector, agent, workflow, and deployment changes.
---

# Verify Garden

This skill proves Garden behavior through the local app. It does not replace
unit tests, package checks, or deployment checks.

## Profile

Use the smallest profile that answers the review question:

| Profile | Use |
| --- | --- |
| `lite` | Run one scenario for the main changed behavior. |
| `standard` | Run each changed behavior and one permission refusal. |
| `full` | Run the full affected feature map and the required remote check. |

This first version documents the profile rules. Scenario drivers will be added
after the local auth and test-data path is stable.

## Launch

Garden's local stack uses Postgres and HelixDB. Offline mode also needs an
OpenAI-compatible model, usually Ollama.

Choose the Docker or native Ollama setup in
[`docs/tutorials/get-started.md`](../../../docs/tutorials/get-started.md).
For Docker-hosted Ollama, run:

```bash
pnpm offline:up:ollama
docker compose -f compose.dev.yaml exec ollama ollama pull qwen3:8b
```

For native Ollama, pull the model first and then start the database services:

```bash
ollama pull qwen3:8b
pnpm offline:up
```

Then run the migration and start Garden:

```bash
pnpm --filter @garden/db db:migrate
pnpm dev:offline
```

Open `http://localhost:3000`. Create an account and a workspace when the local
database is new. Send one chat message to confirm that the model responds.

## Doctor

Run this before driving a feature:

```bash
pnpm run doctor
```

The command checks Node.js, pnpm, Docker, Postgres, HelixDB, and the Garden
root route. It does not start or stop a process.

If the check fails, fix the local stack before reading a product failure from a
scenario.

## Drive

Use the optional `agent-browser` command for the real browser path. The app
README contains the current manual commands:

```bash
agent-browser --session garden-verify open http://localhost:3000/workspace
agent-browser --session garden-verify snapshot -i -c -d 3
agent-browser --session garden-verify console
agent-browser --session garden-verify errors
```

Use accessible names and visible text. Do not use coordinates. Check the visible
result and the stored side effect when the feature writes data.

## Evidence

Save evidence outside the repository. Use one folder per scenario:

```text
~/.garden/evidence/<UTC timestamp>-<scenario>/
  report.md
  report.json
  screenshots/
```

Each report must name the action, the expected result, the observed result, and
the command or route that produced the evidence. Mark a scenario `PASS`,
`FAIL`, or `INCONCLUSIVE`. A passing typecheck is not evidence for a user flow.

## Cleanup

Only stop resources that this run started. When the local stack is no longer
needed, use:

```bash
pnpm offline:down
```

Do not remove evidence during cleanup. Do not reset the database unless the
scenario requires clean state and the user agrees that local data can be lost.

## Feature map

Read the feature file before driving it:

- `features/mvp.md` covers the beta path.
- `features/decide.md` covers Decide installation and the first agent action.

Add a feature file when a shipped user path has no observable proof. Keep the
feature file focused on what a user can do and see.
