# Web TypeScript projects

Garden's Worker application is split into configured TypeScript projects so a
single checker process does not load every client, server, and Worker module.
This changes build tooling only; the deployed runtime remains Cloudflare
Workers/workerd.

```text
shared contracts
      ↓
server implementations
      ↓
Worker entry

shared + server declarations
      ↓
client routes and components
```

## Projects

| Config                  | Ownership                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `tsconfig.shared.json`  | Transport-neutral contracts used by server and client code                              |
| `tsconfig.server.json`  | Server adapters, authentication, persistence, email, and server-owned dashboard queries |
| `tsconfig.entry.json`   | Worker and TanStack Start entrypoints that assemble runtime implementations             |
| `tsconfig.client.json`  | Final no-emit project for routes, React components, and client modules                  |
| `tsconfig.tooling.json` | Final no-emit project for Alchemy, Vite, and Vitest configuration                       |

Shared, server, and entry projects emit declarations into ignored
`.turbo/types` directories. The client project consumes server declarations
instead of reopening server implementation source. The package typecheck runs
projects sequentially, and root Turbo checks are also serialized, so peak
memory does not overlap across workspace packages.

Server implementation modules must not import client modules. Code needed on
both sides belongs in the shared project. Tests remain outside these production
projects and continue to run through Vitest.

Garden uses stable TypeScript 7 native through the `@typescript/native` alias.
The JavaScript TypeScript package remains installed for tools that consume its
compiler API; workspace `tsc` commands resolve to the native checker.
