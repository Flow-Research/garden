# Internal handbook

**Status:** implemented

**Last updated:** 2026-11-02

## Outcome

A signed-in Garden user opens `/handbook` and reads Garden's engineering
docs as a site with a sidebar, instead of hunting through Google
Docs and raw markdown.

## Scope and non-goals

### In scope

- A Fumadocs site mounted at `/handbook` inside the Garden web app.
- Pages written as MDX in `docs/handbook/`, so docs change through pull
  requests next to the code.
- First pages: the architecture overview and the engineering process.

### Out of scope

- Role or workspace restrictions. Any signed-in user can read the handbook.
- Moving the rest of `docs/` into the site. That follows in later pull
  requests, once each file is checked against the MDX parser.
- Public, end-user documentation.
- Architecture decision records (ADRs).

## User behavior

1. A signed-in user opens `/handbook` and sees the overview page with a
   sidebar of handbook pages.
2. A signed-out user who opens `/handbook` is redirected to `/login` and
   returned to the handbook after signing in.
3. An unknown handbook path shows the not-found page.

## System boundary

- Route: `apps/web/src/routes/_authenticated/handbook.$.tsx`. It sits under
  the `_authenticated` layout, which owns the sign-in redirect, and outside
  `_app`, so the handbook uses its own layout instead of the app shell.
- Content source: `apps/web/src/features/handbook/source.ts`, which loads
  `docs/handbook/` through the `fumadocs-mdx` Vite plugin.
- No database, Durable Object, or external service is involved.

## Data and permissions

The handbook reads only the MDX files that ship with the build. The sign-in
check is the only gate.

## Design decisions

- **Fumadocs, not a separate docs site.** Fumadocs supports TanStack Router,
  so the handbook runs in the same Worker, reuses Garden's sign-in, and
  deploys with the code it describes.
- **`/handbook`, not `/docs` or `/dev/docs`.** The name describes the content,
  works the same in every environment, and leaves a `docs.` subdomain free
  for public docs later.
- **The repo is the source of truth.** Google Docs are for drafts only.

## Verification

- `pnpm --filter @garden/web build` compiles the handbook.
- Signed in: `/handbook` and `/handbook/engineering-process` render with the
  sidebar.
- Signed out: `/handbook` redirects to `/login`.
- Unknown path: `/handbook/does-not-exist` shows the not-found page.

Local verification on 2026-11-02: PASS. Evidence in
`~/.garden/evidence/20261102T201606Z-internal-handbook/`.

## Gaps and follow-up

- The sign-in check protects the page, not the files behind it. The
  compiled MDX ships in the app's static JavaScript chunks. Keep
  secrets and credentials out of the handbook.
- Search is not wired yet.
- In dev only, React logs a hydration attribute warning on handbook pages.
  Vite's dependency pre-bundler collapses Fumadocs' nested `lucide-react`
  1.66 and `@base-ui/react` 1.9 onto Garden's 1.8 and 1.4 in the browser.
  Production bundles keep both copies, so server and client match there.
  Aligning Garden's versions removes the warning.
- `fumadocs-mdx` is pinned to 15.4.0, the newest release that accepts
  Garden's `zod` 4.4.3. Later releases require `zod` 4.6.7, which breaks
  Executor's nested `zod` 4.3.6 at runtime.
- Move `docs/core`, `docs/features`, and `docs/known-gaps` into the site.
- Add ADRs and a freshness check (`owner`, `last_reviewed`) in CI.
