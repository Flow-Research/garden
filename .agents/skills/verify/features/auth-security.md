# Authentication dependency security

## User paths

1. Sign in with a password. Read the current session.
2. From an active workspace, link a configured connector.
3. Return through its existing registered callback URL.
4. Check the owned account and one connected receipt.
5. Reconnect the same account. Check that the account ID remains the same.
6. Remove Google by its internal account ID when password sign-in remains.

## Refusals

Reject forged, expired, replayed or unbound OAuth state.
Reject a callback from another session, user, workspace or provider.
Reject a callback after logout or membership removal.
Reject an expired session after a database lock wait.
Reject password-account removal and another user's account ID.
Reject server-function requests without same-origin evidence.
Keep ordinary callback and signed transport routes under their own checks.

## Automated evidence

`apps/web/src/lib/auth/connector-callback.integration.test.ts` runs the real Better Auth handler and Drizzle adapter against isolated PostgreSQL.
It replaces the external token endpoint and capability discovery with local fixtures.
It checks account and callback-event rows, database wait refusal, simultaneous callbacks, and receipt failure after commit.
The replay cases share one signed state and cookie with distinct synthetic accepted codes.
They overlap real PostgreSQL reads and deletion waits, including an earlier snapshot resumed after the winner consumes the row.
Each schedule requires one successful target, one state refusal, one token exchange for the reused state, and one new receipt.
Wrong-cookie refusal leaves the legitimate state available. Expired state and failed consumption cannot start token exchange.
Changed consumed-row IDs or values also refuse before exchange.
Two fresh Node processes consume one real PostgreSQL verification row through the installed internal adapter.
Exactly one process receives the row. This proves the storage operation across SDK instances, not a full callback journey across processes.
These synthetic provider results do not establish a live-provider exploit.
The receipt fault uses a temporary constraint only in the isolated test database.
No production schema change is required.

`apps/web/src/start-security.test.ts` runs the installed Start request handler with Garden's actual middleware.
Only framework-generated entries and the test function resolver use fixtures.
The ordinary-route preservation case invokes the actual middleware directly.
It does not prove a live signed-host or WorkStream callback.

`pnpm test:dependency-security` checks the patched serialization, proxy trust and shell quoting behaviors.
It does not execute generated shell text.

`apps/web/src/features/editor/content-editor.dependencies.test.tsx` renders the actual `ContentEditor` with the installed Tiptap and ProseMirror packages.
It covers Markdown load and save, typing with input rules, marks, links, paste paths, mentions and file cards.
Four cases check the patched advisories: Markdown attribute parse time, the `mergeAttributes` prototype and slice-context attribute validation.
These four cases fail with Tiptap `3.22.4` and ProseMirror View `1.41.8`. The other cases pass with both versions.
The tests run in JSDOM. They do not prove browser selection, IME input or a real clipboard.

## Environment evidence

Local handler checks do not prove an actual Google or Slack provider round trip.
Provider acceptance and deployment-target checks remain separate release gates.
Authorization attempts that started before the state-binding change must restart.

## Parser and transport compatibility

`parser-owner-compatibility.test.ts` parses valid, incomplete, and empty-merge YAML through the installed Executor OpenAPI owner.
`scripts/parser-transport.test.mjs` uses actual dependency owners and bounded loopback fixtures.
It covers AJV references, URI normalization and port refusal, JSON and form bodies, compressed bodies with trailing bytes, multipart boundaries and part headers, and the default YAML merge limit.
For each Undici major branch, it covers redirect credential and shared-cache separation, WebSocket subprotocol refusal, excess content encodings, local connection errors, and explicit TLS trust.
The Think CLI reads valid and incomplete TOML from disposable project directories.
OpenSSL creates only temporary local TLS fixtures. The tests remove those files and close their listeners.
`document-artifact-projection.test.ts` in agent-runtime and `extractor.test.ts` in brain cover Mammoth DOCX conversion with valid and malformed Word XML.
These cases do not establish a live provider, native device, or deployed Worker result.

## Build tools and same-branch packages

`scripts/build-tooling-dependencies.test.mjs` runs with `pnpm test:dependency-security`.
It resolves `minimatch` from ExcelJS archive tooling, TypeORM and just-bash, then checks valid brace expansion and the nested brace inputs from the advisories.
It resolves Browserslist from Babel and checks target resolution and custom usage statistics with inherited key names.
It resolves `nanoid` and `source-map-js` from PostCSS and checks zero-size identifiers, a previous source map, and refusal of extreme indexed section offsets.
It runs `scripts/screenshot-webp.mjs` on generated PNG and SVG files in a temporary directory, and checks refusal of a truncated PNG.
It checks that Miniflare and `@xenova/transformers` load the same Sharp, and reads an image through `@xenova/transformers`.
`packages/agent-runtime/src/workspace-git-symlink-checkout.test.ts` uses the `@cloudflare/shell` Git commands on its in-memory file system.
It checks a normal branch switch and the refusal to write below a directory symlink that leaves the working tree.
The production build and the Vitest suites are the Vite evidence. The Vite advisory applies to Windows and has no local exploit test.
These cases do not establish a deployed Worker result or an image result on Linux.
