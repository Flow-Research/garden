---
title: Authentication and server-function dependency security
description: Patched dependency family, callback preservation, and required compatibility evidence.
status: proposal
owner: "@Umoren"
last_reviewed: 2026-11-21
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

The compatibility tests use the actual Executor OpenAPI importer, Think inspection command, AJV, Express body parser, multipart parser, and both Node transports.
TOML is a configuration file format.
Think inspection reports whether its TOML parsed. That result does not establish a deployed application.
The Executor OpenAPI importer reads YAML with the JSON schema of `js-yaml`, so it reads a merge key as plain data.
The empty-merge input therefore adds no merge work in the importer. The default `js-yaml` loader refuses that input.
DOCX is a Word document format.
The agent-runtime and brain document tests give Mammoth valid and malformed Word XML in a small archive.
The malformed inputs have a repeated attribute, content after an end-tag name, or unterminated attribute values.
Each malformed input returns the typed import or extraction error.

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
