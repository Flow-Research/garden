---
title: Authentication and server-function dependency security
description: Patched dependency families, callback preservation, and required compatibility evidence.
status: proposal
owner: "@Umoren"
last_reviewed: 2026-11-28
---

## Scope

The security change updates TanStack Start and its declared Router family, Better Auth, Seroval, proxy-addr, and shell-quote.
The selected Start release declares the Router and server-core versions. These versions must remain coherent.
An audit result does not establish application compatibility or deployment acceptance.

## Parser and transport compatibility

The next dependency unit retains the reviewed version branches.
The declared Node minimum is `22.19.0`, which the installed Undici 8 branch already requires.
The setup check `pnpm doctor` and the setup pages use the same minimum.
Local checks use Node `22.22.2`.

| Dependency        | Selected version |
| ----------------- | ---------------- |
| `@fastify/busboy` | `3.2.1`          |
| `@xmldom/xmldom`  | `0.8.15`         |
| `body-parser`     | `2.4.0`          |
| `fast-uri`        | `3.1.7`          |
| `js-yaml`         | `4.3.2`          |
| `smol-toml`       | `1.7.1`          |
| `undici` major 7  | `7.30.1`         |
| `undici` major 8  | `8.12.2`         |

`body-parser@2.4.0` declares `qs@^6.16.1`, so a scoped override gives that branch `qs@6.16.1`.
A test checks that the installed query parser is in the declared range.
Other query-parser branches retain their separate versions and audit findings.
The package manager generates the dependency lock with lifecycle scripts disabled.

The compatibility tests use the actual Executor OpenAPI importer, wrangler's `smol-toml` owner, AJV, Express body parser, multipart parser, and both Node transports.
TOML is a configuration file format.
The wrangler TOML owner parses a valid document and refuses incomplete input. That result does not establish a deployed application.
The Executor OpenAPI importer reads YAML with the JSON schema of `js-yaml`, so it reads a merge key as plain data.
The empty-merge input therefore adds no merge work in the importer. The default `js-yaml` loader refuses that input.
DOCX is a Word document format.
The agent-runtime and brain document tests give Mammoth valid and malformed Word XML in a small archive.
The malformed inputs have a repeated attribute, content after an end-tag name, unterminated attribute values, or an unclosed processing instruction or CDATA section.
Each malformed input returns the typed import or extraction error.

Every DOCX read in Garden parses Word XML with Mammoth and `@xmldom/xmldom` 0.8.15.
This covers the agent-runtime offline import, upload outline, and text extraction, and brain extraction.
xmldom 0.8 recovers from a malformed tag by moving one character forward and parsing again.
Crafted XML therefore made the parser do quadratic work. About 48 KB held a Worker for 16 seconds.
Two [dependency patches](../../../patches/README.md) bound this work in the parser that every path shares.
Mammoth stops at the first parser diagnostic. It previously rejected such a part only after the parse finished.
xmldom reports an unclosed processing instruction or CDATA section, and its text-node merge is linear.
Documents that parse without a diagnostic convert exactly as before.
xmldom 0.9 is linear on these inputs, but Mammoth 1.12 declares `^0.8.6` and calls `parseFromString` without the MIME type that 0.9 requires.
A timeout cannot stop this synchronous parse, and a size limit alone does not help because the crafted inputs are small.
Regression tests run five crafted inputs through each DOCX path and require each import to finish within one second.
The unpatched parser takes 5 to 25 seconds on each input.
The parser transport test loads Mammoth's own xmldom and checks each patched path directly.
It checks the first diagnostic, the two unclosed constructs, and the scaling of `normalize()`.

The HTTP fixtures bind only to loopback addresses and use synthetic header values.
TLS encrypts a network connection.
The fixtures test redirect credential separation, transport errors, WebSocket subprotocol refusal, and explicit TLS trust.
They also test a server that sends an unrequested WebSocket subprotocol, a response with too many content encodings, and a cross-origin redirect with a shared cache.
The body-parser fixture sends compressed JSON with bytes after the compressed frame. The server returns status 400 and continues to serve requests.
The multipart fixture uses a 252-byte boundary and part headers named `__proto__` and `constructor`.
The URI fixture checks normalization and refuses a port that is not a number.
The TLS fixture requires OpenSSL and creates a temporary self-signed certificate for the local listener.
Cleanup removes its temporary files and closes its owned connections.
These tests cover local Node owners. Deployed Worker behavior retains its separate requirements.

## Build tools and same-branch packages

The third dependency unit keeps each package in the version branch that its parent declares.
An override is a root `package.json` rule that makes pnpm install an exact version.

| Dependency                 | Selected version | Parent that installs it                         |
| -------------------------- | ---------------- | ----------------------------------------------- |
| `brace-expansion` major 1  | `1.1.22`         | ExcelJS archive tooling through `minimatch@3`   |
| `brace-expansion` major 2  | `2.1.8`          | TypeORM and archive tooling through `minimatch` |
| `brace-expansion` major 5  | `5.0.13`         | just-bash through `minimatch@10`                |
| `isomorphic-git`           | `1.38.6`         | `@cloudflare/shell`                             |
| `browserslist`             | `4.28.7`         | Babel                                           |
| `nanoid` major 3           | `3.3.18`         | PostCSS                                         |
| `source-map-js`            | `1.2.2`          | PostCSS                                         |
| `postcss`                  | `8.5.26`         | Vite                                            |
| `vite`                     | `8.2.4`          | `@garden/web` and Vitest                        |
| `launch-editor`            | `2.14.2`         | TanStack devtools                               |
| `sharp`                    | `0.35.5`         | Miniflare, the embedding library, root scripts  |

The `brace-expansion` versions are the newest release of each branch.
The first patched releases still have an open moderate advisory.
All workspace packages now use one Vite version. The web build moved from Vite `8.0.16` to `8.2.4`, which uses Rolldown `1.2`.
Vite `8.2.4` declares `postcss@^8.5.26`, so the PostCSS override moved from `8.5.23` to `8.5.26`.
Vite `8.2.4` reads path aliases only from the TypeScript project that includes the importing file.
The root `apps/web/tsconfig.json` now references `apps/web/tsconfig.test.json`, so web test files keep the `@/` aliases. The typecheck commands are unchanged.
One Sharp version replaces the two earlier versions. Both Miniflare versions declare Sharp `0.35.2`, so `0.35.5` is in their branch.
The embedding library `@xenova/transformers` declares Sharp `^0.32.0`. Sharp was already outside that range. A test reads and resizes an image through that library.
The Vite and `launch-editor` advisory applies to Windows only. The local checks are the production build and the Vitest suites, not an exploit test.

The compatibility tests use the installed owners.
Each `minimatch` owner expands valid brace sets and returns from the nested brace inputs in the advisories.
The `@cloudflare/shell` Git commands run on its in-memory file system.
A checkout must refuse to write a file below a directory symlink that leaves the working tree. A symlink is a file that points to another path.
Babel resolves browser targets. Browserslist reads custom usage statistics that contain inherited key names such as `__proto__`.
The PostCSS identifier generator ends when the size is zero. That check runs in a child process.
PostCSS retains a previous source map and refuses an indexed source map with an extreme section offset.
`scripts/screenshot-webp.mjs` converts generated PNG and SVG inputs in a temporary directory and refuses a truncated PNG.

GraphQL Tools, protobufjs, Tiptap and ProseMirror View retain their high audit findings.
The patched GraphQL Tools and protobufjs releases are in a later major version than their parents declare.
Tiptap and ProseMirror View need a separate rich-text unit with editor tests.

## Server functions

A server function is an HTTP operation supplied by TanStack Start.
Garden supplies explicit request middleware, so it must include the framework's supported CSRF middleware.
CSRF is a request made through another website.
The middleware applies only to server-function requests and uses the framework's same-origin policy.
Ordinary API routes and OAuth callbacks retain their existing authentication and signature rules.
Private functions still require Garden's current request context and authority checks.

## Connector callbacks

Better Auth 1.7 uses the core `/api/auth/callback/:id` handler for generic OAuth providers.
Garden retains each configured provider's registered `/api/auth/oauth2/callback/:providerId` URL through the supported `redirectURI` option.
A narrow boundary adapter maps only configured provider callback paths to the core handler.
The adapter retains the method, origin, query, and headers. It does not redirect the browser to an arbitrary target.
The same registered URL must appear during authorization and token exchange.
The server plugin remains enabled. The client uses the supported core social-provider APIs.
The server stores the initiating user, session, workspace and provider in Better Auth's `serverContext` through `addOAuthServerContext`.
Client `additionalData` cannot replace these values.
An old authorization attempt without this binding must restart.
Connector authorization uses the core `linkSocial` API. Connector sign-in cannot bypass the workspace link flow.

Database-backed OAuth state must be consumed once before token exchange.
The maintained Better Auth package patch uses the SDK's atomic `consumeVerificationValue` operation after the signed state-cookie check.
The consumed row must match the validated snapshot's ID and value.
A missing, changed, expired, or already consumed row refuses the callback before exchange.
An invalid browser cookie cannot consume a valid state.
The patch does not change cookie-backed state or hold a database lock across token exchange.

The account adapter uses a short PostgreSQL transaction after token exchange.
A transaction advisory lock uses the provider and remote account ID to serialize an identity that has no row yet.
This identity is global in the installed SDK's `findAccountByKey` contract.
The adapter locks the user and workspace references, the account, the session, and the membership before it checks current authority.
User and workspace key-share locks block removal without conflicting with callback receipt references.
The adapter checks session expiry after all lock waits and again after the account write.
The delegated Drizzle adapter writes through that same transaction.
The normal auth adapter retains its existing `transaction: false` behavior and passes its guarded adapter to nested SDK operations.
No schema or migration change is required.

The account after-hook records completion only after an actual account write commits.
If the receipt cannot be recorded, the callback returns an error and does not emit a success receipt.
The account can already be saved in this case. The user must refresh the connections page.
Replaying the consumed state cannot repeat the write.

Google unlink uses the auth account row ID required by Better Auth 1.7.
The server looks up that ID among the caller's accounts before it applies Garden's password and Google unlink policy.
Password removal remains refused.

## Rich-text editor dependencies

Tiptap is the rich-text editor library of `@garden/web`. Tiptap uses ProseMirror for its document model and view.
`ContentEditor` is the only Tiptap editor. Issue, comment, reply and create-issue forms use it.
All `@tiptap/*` packages use the exact version `3.33.0`. The Tiptap packages declare exact versions of each other, so the versions must stay equal.

| Dependency          | Before   | Selected version | Advisory fixed                                                     |
| ------------------- | -------- | ---------------- | ------------------------------------------------------------------ |
| `@tiptap/*`         | `3.22.4` | `3.33.0`         | Markdown attribute parse time (3.30.5), `mergeAttributes` (3.30.4) |
| `prosemirror-view`  | `1.41.8` | `1.42.9`         | Attribute validation for pasted slice context (1.42.3)             |
| `prosemirror-model` | `1.25.4` | `1.25.13`        | None. `@tiptap/pm` `3.33.0` declares `^1.25.12`.                   |
| `linkifyjs`         | `4.3.2`  | `4.4.0`          | None. The link extension declares it.                              |

Version `1.43.0` of `prosemirror-view` is in the declared range. The lock file keeps `1.42.9`, because `1.43.0` was released on 2026-11-19 and changes mouse selection handling.
No override holds this version. A later lock update can select `1.43.0`.

A slice context is the list of parent nodes that ProseMirror writes into the `data-pm-slice` attribute of copied HTML.
The paste extension of Garden sends HTML with this attribute to the ProseMirror paste path.
The patched view runs attribute validators for the parent nodes in the slice context.
Garden node attributes declare no validators. Thus the patch does not change the result of a Garden paste.
The ProseMirror model ignores context attributes that a node does not declare.

The vulnerable Markdown attribute parsers are in `@tiptap/core`. The upstream mention extension uses the inline parser.
The Garden mention extension replaces that tokenizer. The Garden editor did not show the slow parse with the old version.

The compatibility tests render the actual `ContentEditor` with Garden extensions.
They load and save headings, marks, lists, quotes, code blocks, tables, mentions and file cards.
They type Markdown shortcuts, typography and a URL, and set and refuse links.
They paste plain Markdown, a URL over selected text, and HTML from another Garden editor.
Separate tests check the patched parse time, the `mergeAttributes` prototype result and slice-context validation.

## Acceptance

Run focused callback, session, middleware, serialization, proxy, and shell regressions.
Run workspace tests, typechecks, build, lint, formatting, and the production dependency audit.
Record remaining audit findings without an ignore rule or a lower severity threshold.
Actual provider callbacks and retained-target deployment require their separate authorized environment evidence.

## Verification boundary

The [verification map](../../../.agents/skills/verify/features/auth-security.md) names the local handler and database tests.
The callback tests use real signed session cookies, OAuth state, Drizzle queries and isolated PostgreSQL.
External token exchange and capability discovery use local fixtures.
The Start tests execute the installed request handler with Garden's middleware and a test server-function resolver.
The ordinary-route preservation check exercises only the middleware filter.
These checks do not qualify actual provider credentials, a deployed callback, or signed external transport.

## Sources

- [Better Auth OAuth server context](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/concepts/oauth.mdx).
- [TanStack Start middleware](https://tanstack.com/start/latest/docs/framework/react/guide/middleware).
- Installed Better Auth 1.7.16 public adapter types, `findAccountByKey`, state and callback source.
- Installed Drizzle adapter transaction source and PostgreSQL row-lock behavior.
