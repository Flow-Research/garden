# Decide integration

## Sub-features

- Decide appears in the Executor catalog.
- A workspace can install and authorize Decide.
- The Decide diagnostic can find the connection and the `whoami` tool.
- A Decide-backed agent operation returns a visible result or a useful failure.

## How to get to it (user POV)

1. Open the Connections surface in a test workspace.
2. Install the Decide connector at `https://api.trydecide.ai/mcp`.
3. Complete authorization in the test environment.
4. Run the Decide diagnostic from the connected workspace.
5. Ask the workspace agent to perform one safe Decide operation.
6. Confirm the result or the failure details in Garden.

Issue [#211](https://github.com/Flow-Research/garden/issues/211) requires a
fresh installation and an agent operation check in `dev`, staging, and
production. Run the environments in that order. Use preview or `dev` for the
first check.

## Driving it with the Garden verification workflow

The server diagnostic route is `POST /api/executor/decide/diagnose`. It checks
the catalog, connection, tool lookup, direct MCP call, MCP handoff, and result
parsing without returning the provider identity.

Use the live Connections and agent surfaces for the first proof. Do not call a
test-only route to claim that installation works. The browser driver and a safe
test workspace are still pending.

## Gotchas

- The test workspace needs a fresh Decide connection. A stale connection does
  not prove installation.
- Do not put provider credentials in reports, screenshots, or chat.
- Decide can take several minutes for analysis. Do not add a new timeout without
  evidence that the current provider or request boundary needs it.
- A provider failure must stay visible as a diagnostic failure. Do not turn it
  into a successful fallback path.
