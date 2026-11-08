# Internal handbook

## Sub-features

- `/handbook` requires a signed-in user and has no role check.
- The sidebar lists the Diátaxis sections from `docs/**/meta.json`.
- Every page under `docs/` site folders renders with its title.
- Relative links between docs resolve to `/handbook/...` URLs. Links to other repository files go to GitHub on `dev`.
- The page scrolls with the mouse wheel inside the handbook container.

## How to get to it (user POV)

1. Sign out, then open `/handbook`. You land on `/login?redirect=%2Fhandbook`.
2. Sign in. You return to `/handbook` and see the **Garden handbook** home page.
3. Check that the sidebar shows **Tutorials**, **How-to guides**, **Concepts**, **Reference**, **Decisions**, **Proposals**, and **Archive**.
4. Click **Get started** in the home page table. The URL becomes `/handbook/tutorials/get-started`.
5. Open `/handbook/reference/known-gaps` and scroll with the mouse wheel. The table moves and the **On this page** list stays in place.
6. Open `/handbook/does-not-exist`. Garden shows its not-found page.

## Driving it with the Garden verification workflow

Run `pnpm verify:docs` first. It fails on broken links, missing paths, bad frontmatter, and sidebar entries with no page, so a passing run means every page should build.

Use the live app for the user path. To check every page, sign in once, save the `better-auth.session_token` and `better-auth.session_data` cookies, then request each `/handbook/<path>` derived from the files under `docs/tutorials`, `docs/guides`, `docs/concepts`, `docs/reference`, `docs/decisions`, `docs/proposals`, and `docs/archive`. Each response should contain an `<h1>` and no error page.

Check scroll in a real browser. The handbook scrolls inside its own `h-svh overflow-y-auto` container because the root layout sets `overflow-hidden` on `body`. Read `scrollTop` on that container before and after a mouse-wheel event.

## Gotchas

- The signup form can submit before React hydrates on a cold dev server, leaving the URL at `/signup?`. Wait for hydration, or create the account through `POST /api/auth/sign-up/email` and set the session cookies in the browser.
- Dev mode logs a hydration warning from Fumadocs' nested `lucide-react` and `@base-ui` versions. Production bundles are correct. Do not treat that warning as a handbook failure.
- Adding or deleting files under `docs/` while the dev server runs can hang `/handbook`. Restart the dev server after large moves.
- Page text ships in public JavaScript. Never paste secrets into a page to test it.
