---
title: The handbook serves the repository's docs folder inside Garden
description: How /handbook renders docs/ with Fumadocs, why it lives in the Garden Worker, and the limits a writer needs to know.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-27
---

The handbook is Garden's engineering documentation, served at `/handbook` inside the Garden web app. It renders the `docs/` folder of the repository. A merged pull request that changes a doc changes the handbook, with no second copy to keep in sync.

## Any signed-in user can read it

`apps/web/src/routes/_authenticated/handbook.$.tsx` sits under the `_authenticated` layout, which owns the sign-in redirect. A signed-out visitor who opens `/handbook` goes to `/login` and comes back after signing in. The route sits outside `_app`, so the handbook uses its own layout instead of the app shell. An unknown handbook path throws `notFound()`.

No role or workspace check applies. The handbook uses no database, Durable Object, or external service.

## Only the Diátaxis folders become pages

`apps/web/src/features/handbook/source.ts` loads `docs/` through the `fumadocs-mdx` Vite plugin. It includes `index.mdx` and the `tutorials`, `guides`, `concepts`, `reference`, `decisions`, `proposals`, and `archive` folders. Each folder's `meta.json` sets the sidebar order.

Other files in `docs/` are not pages. `docs/README.md` stays a reading guide for GitHub and agents. `assets/`, `diagrams/`, `templates/`, and `garden-os/` are left out.

## Relative links work on GitHub and in the handbook

Docs link to each other with relative paths, so they read correctly on GitHub. `remarkHandbookLinks` in `apps/web/src/features/handbook/remark-handbook-links.ts` rewrites those links at build time. A link to another page in `docs/` becomes its `/handbook/...` URL. A link to any other repository file becomes a GitHub URL on the `dev` branch. Absolute URLs and in-page anchors stay unchanged.

## Why the handbook lives in the app

- **Fumadocs, not a separate docs site.** Fumadocs supports TanStack Router, so the handbook runs in the same Worker, reuses Garden's sign-in, and deploys with the code it describes.
- **`/handbook`, not `/docs`.** The name describes the content, works the same in every environment, and leaves a `docs.` subdomain free for public docs later.
- **The repository is the source of truth.** Google Docs are for drafts only.

## Limits a writer needs to know

- The sign-in check protects the page, not the files behind it. The compiled MDX ships in the app's static JavaScript chunks. Keep secrets and credentials out of the handbook.
- Search is off. `RootProvider` disables it until a search route exists.
- The handbook follows the app's light or dark setting. Fumadocs' own theme toggle is off.
- `fumadocs-mdx` is pinned to 15.4.0, the newest release that accepts Garden's `zod` 4.4.3. Later releases need a newer `zod` that breaks Executor's nested `zod` at runtime.
- In dev only, React can log a hydration attribute warning on handbook pages. Vite's dependency pre-bundler collapses Fumadocs' nested `lucide-react` and `@base-ui/react` onto Garden's older copies. Production bundles keep both copies.

## Images use relative paths

A page embeds an image with a relative path, such as `![Garden components](../../diagrams/garden-components.drawio.svg)`. The same path works on GitHub. In the handbook, Fumadocs' `remarkImage` plugin turns the path into an import, so Vite bundles the file as a hashed asset. `remarkHandbookLinks` rewrites links only, so it leaves image paths for the bundler. `remarkHandbookLinks` and `source.test.ts` test both behaviors.

Image folders are not pages. Architecture diagrams live in `docs/diagrams/`, outside the page globs in `source.ts`, so they add no page or sidebar entry. See [architecture diagrams](../architecture/diagrams.md).

A draw.io diagram shows on a white card in both themes. `handbook.css` styles any image whose path contains `.drawio`. An SVG loaded through `<img>` cannot follow the page theme, and the diagrams use their own light palette, so a white card keeps them readable in dark mode without changing their colors.

To write or move a page, follow [write a feature doc](../../guides/develop/write-a-feature-doc.md).
