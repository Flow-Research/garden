---
title: Garden's design comes from one generated token system
description: Why Garden moved from the hand-written parchment look to a flat, generated token system with light and dark modes, and what that means when you style a surface.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-03
---

Garden's look is defined by design tokens exported from the design file, not by hand-written CSS. The tokens describe a flat interface: a white ground in light mode, a dark gray ground in dark mode, a deep green brand, Inter for UI text, and a small set of radii and shadows. The values themselves are listed in [design tokens](../../reference/design-tokens.md).

## The parchment era ended with the 2026-09 redesign

Garden's first locked direction was a "cultivated workshop": a warm parchment ground with film grain, pastel washes, frosted vellum panels, a light Fraunces display serif, and a foliage status palette of sage, moss, amber, clay, and stone. Every interactive element was a pill, and the shell was an icon rail, a context rail, and a FlexLayout dock.

The 2026-09 redesign, drawn in the Penpot "Garden" file, replaced all of that. The shell became a flat labeled sidebar, a 40px top bar, and a routed content pane (`AppShell` in `apps/web/src/components/shell/app-shell.tsx`). The token file replaced the parchment palette. `packages/ui/scripts/build-tokens.mjs` records that the parchment-era aliases, such as `--ink`, `--hairline`, and `--moss`, were removed once nothing used them. `packages/ui/styles/base.css` now paints the body with `--background-main-default` and notes that there is no atmosphere or grain.

If an older doc or screenshot shows parchment, grain, or Fraunces, it describes the retired direction.

## Tokens are generated so the design file stays canonical

`packages/ui/tokens/tokens.json` is a Tokens Studio export. `pnpm --filter @garden/ui tokens:build` turns it into `packages/ui/styles/tokens.css`, which is marked as generated. A design change becomes a re-export and one command, not a manual merge of CSS.

The generator also settles conflicts with Tailwind on purpose. Where the token scale and Tailwind's defaults disagree, such as `text-lg` at 20px instead of 18px or `rounded-md` at 8px instead of 6px, the token value wins. If a Tailwind utility renders a size you did not expect, the token file is the reason.

## Components use semantic tokens through the shadcn contract

The token file has three layers:

1. **Primitives** are raw scales, such as `--brand-500` or `--gray-300`.
2. **Semantic tokens** name a role, such as `--background-main-default` or `--text-danger-default`. They hold different values in light and dark mode.
3. **Compat aliases** map the semantic tokens onto the shadcn contract (`--background`, `--foreground`, `--primary`, `--border`) plus Garden extras (`--brand`, `--success`, `--warning`, `--info`, `--priority`).

Components use the compat and semantic layers through Tailwind classes such as `bg-background`, `text-muted-foreground`, and `border-border`. Because the aliases point at semantic tokens, they switch with dark mode for free. Reaching for a primitive in a component skips that switch and pins the color in both modes.

## Dark mode is a first-class mode

The parchment direction treated light as canonical and deferred dark mode. The token system ships both. `:root` holds the light semantic set and `:root.dark` overrides it. Users choose in Settings under Appearance (`apps/web/src/features/settings/components/appearance-tab.tsx`).

## Fonts are owned by the app

`tokens.css` never names a font family. `apps/web/src/styles.css` defines the stacks:

- `--font-sans` is Inter Variable, used for all product UI.
- `--font-heading` is Cabinet Grotesk at weight 700, used by the large `title-*` utilities. It is vendored in `packages/ui/fonts/cabinet-grotesk/` because it is not on npm or Google Fonts.
- `--font-mono` is Geist Mono Variable, used for code and identifiers.
- `--font-prose` points at `--font-sans`. Chat prose used DM Sans in the parchment era. Inter now takes that role.

## Some old class names survive with new meaning

The `.vellum` and `.vellum-heavy` classes in `packages/ui/styles/base.css` still exist. They now paint `--card` and `--popover` with a blur and `--shadow-1`. Treat them as card and popover surfaces, not as the frosted glass of the old direction.
