# MVP beta path

## Sub-features

- Account and workspace creation.
- Agent chat.
- Tool connection and permission display.
- Issue creation and agent run.
- Approval and work-product review.

## How to get to it (user POV)

1. Open Garden with a new local database.
2. Create an account and a workspace.
3. Connect a test tool that is available in the local environment.
4. Open chat and send a request that uses the connected tool.
5. Create an issue and assign it to the workspace agent.
6. Let the issue run reach an approval request.
7. Approve the request and review the resulting work product.

## Driving it with the Garden verification workflow

The local stack and manual browser commands are in the parent `SKILL.md`.
Use `pnpm run doctor` before the run. Capture the action and the resulting state in
one evidence folder.

The driver is pending because Garden does not yet have stable seeded auth and
workspace data for this path. Until the driver exists, a manual run is
`INCONCLUSIVE` unless it has a saved report and screenshots.

## Gotchas

- Offline mode needs an OpenAI-compatible model. Ollama is the documented local
  option.
- A new database needs migrations before the app can create a workspace.
- Connector credentials are optional for local startup but required for a real
  connector action.
- Approval behavior depends on the tool risk class and the agent grant.
