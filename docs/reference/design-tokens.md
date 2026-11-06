---
title: Design tokens
description: The color, type, radius, shadow, and spacing tokens Garden ships, with their CSS variables and light and dark values.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-05
---

Source: `packages/ui/styles/tokens.css`, generated from `packages/ui/tokens/tokens.json` by `pnpm --filter @garden/ui tokens:build`. Do not edit `tokens.css` by hand. Font stacks are defined in `apps/web/src/styles.css`. For the reasoning behind the system, see [design direction](../concepts/design/design-direction.md).

## File layout

| Block | Contents |
| --- | --- |
| `:root` | Primitive scales, type atoms, radii, shadows, spacing, sizes, strokes, light semantic tokens, compat aliases |
| `:root.dark` | Dark semantic tokens and scrollbar overrides |
| `@theme inline` | Tailwind v4 bindings for the variables above |
| `@utility` | Composite typography classes |

## Ground

The body background is `--background-main-default` (`packages/ui/styles/base.css`). The ground is the flat Garden parchment in light mode and green-tinted charcoal in dark mode. There is no grain or atmospheric gradient.

## Primitive color scales

Each scale has steps 100 to 1000: `--black-*`, `--blue-*`, `--brand-*`, `--gray-*`, `--green-*`, `--pink-*`, `--red-*`, `--slate-*`, `--white-*`, `--yellow-*`. Utility colors are `--util-color-1` to `--util-color-19`.

| Step | `--brand-*` | `--gray-*` |
| --- | --- | --- |
| 100 | `#f5fffb` | `#f5f5f5` |
| 200 | `#8efed3` | `#e6e6e6` |
| 300 | `#26fcab` | `#d9d9d9` |
| 400 | `#02b773` | `#b3b3b3` |
| 500 | `#015032` | `#757575` |
| 600 | `#01452b` | `#444444` |
| 700 | `#013a24` | `#383838` |
| 800 | `#012f1d` | `#2c2c2c` |
| 900 | `#002417` | `#1e1e1e` |
| 1000 | `#001910` | `#111111` |

## Garden palette

The brand green, success green, and page ground use the original Garden palette, restored on 2026-11-05. These primitives live in the `garden` group of `tokens.json` and are emitted as `--garden-*`.

| Primitive | Value | Used for |
| --- | --- | --- |
| `--garden-moss-light` | `#4d7250` | Brand green, light mode |
| `--garden-moss-dark` | `#7a9b6f` | Brand green, dark mode |
| `--garden-sage-light` | `#7a9b6f` | Success green, light mode |
| `--garden-sage-dark` | `#9bb491` | Success green, dark mode |
| `--garden-parchment` | `#f9f7f2` | Page ground, light mode |
| `--garden-parchment-deep` | `#efebe1` | Secondary ground, light mode |
| `--garden-charcoal` | `#1a1f1c` | Page ground, dark mode |
| `--garden-charcoal-deep` | `#232a25` | Secondary ground, dark mode |

The `--brand-*` scale below still feeds the brand secondary and tertiary variants.

## Key semantic tokens

Semantic tokens follow the pattern `--{background|text|border|icon}-{role}-{variant}`. Roles are `main`, `neutral`, `brand`, `success`, `warning`, `danger`, `disabled`, and `utilities`. The table lists the most used ones. See `tokens.css` for the full set.

| Token | Light | Dark |
| --- | --- | --- |
| `--background-main-default` | `#f9f7f2` | `#1a1f1c` |
| `--background-main-secondary` | `#efebe1` | `#232a25` |
| `--background-brand-default` | `#4d7250` | `#7a9b6f` |
| `--background-brand-secondary` | `#8efed3` | `#01452b` |
| `--background-success-default` | `#7a9b6f` | `#9bb491` |
| `--background-warning-default` | `#e8b931` | `#e8b931` |
| `--background-danger-default` | `#ec221f` | `#c00f0c` |
| `--text-default` | `#1e1e1e` | `#f5f5f5` |
| `--text-neutral-default` | `#303030` | `#e3e3e3` |
| `--text-neutral-secondary` | `#5a5a5a` | `#cdcdcd` |
| `--text-secondary` | `#757575` | `#b3b3b3` |
| `--text-brand-default` | `#4d7250` | `#7a9b6f` |
| `--text-danger-default` | `#900b09` | `#fdd3d0` |
| `--border-default` | `#d9d9d9` | `#444444` |
| `--border-brand-default` | `#4d7250` | `#7a9b6f` |

Badge tokens: `--badge-{blue|green|yellow|gray}-{background|text}`.

## Compat aliases

These map semantic tokens to the shadcn contract and switch with dark mode.

| Alias | Value |
| --- | --- |
| `--background`, `--card`, `--popover`, `--sidebar` | `var(--background-main-default)` |
| `--foreground` | `var(--text-neutral-default)` |
| `--primary`, `--brand`, `--sidebar-primary` | `var(--background-brand-default)` |
| `--primary-foreground`, `--brand-foreground` | `var(--text-brand-on-brand)` |
| `--secondary` | `var(--background-neutral-secondary)` |
| `--muted`, `--accent`, `--sidebar-accent` | `var(--background-main-secondary)` |
| `--muted-foreground` | `var(--text-neutral-secondary)` |
| `--destructive` | `var(--background-danger-default)` |
| `--border`, `--input`, `--sidebar-border` | `var(--border-default)` |
| `--ring`, `--sidebar-ring` | `var(--border-brand-default)` |
| `--success` | `var(--text-success-secondary)` |
| `--warning` | `var(--text-warning-secondary)` |
| `--info` | `var(--blue-500)` |
| `--priority` | `var(--text-danger-secondary)` |
| `--chart-1` to `--chart-5` | `--util-color-2`, `-8`, `-3`, `-10`, `-12` |
| `--radius` | `12px` |

## Fonts

| Variable | Stack | Use |
| --- | --- | --- |
| `--font-sans` | `'Inter Variable'`, system sans | All product UI |
| `--font-heading` | `'Cabinet Grotesk'` (700 only), then Inter | `title-*` utilities |
| `--font-mono` | `'Geist Mono Variable'`, system mono | Code and identifiers |
| `--font-prose` | `var(--font-sans)` | Chat prose |

## Type scale

Font sizes override Tailwind defaults.

| Utility | Size | Line height |
| --- | --- | --- |
| `text-xs` | 12px | 160% |
| `text-sm` | 14px | 160% |
| `text-base` | 16px | 160% |
| `text-lg` | 20px | 160% |
| `text-xl` | 24px | 140% |
| `text-2xl` | 32px | 140% |
| `text-3xl` | 40px | 140% |
| `text-4xl` | 48px | 120% |
| `text-5xl` | 64px | 120% |
| `text-6xl` | 72px | 120% |

Tracking: `tracking-tightest` -0.04em, `tracking-tighter` -0.02em, `tracking-normal` 0, `tracking-wide` 0.01em, `tracking-wider` 0.02em.

## Typography utilities

| Class | Family | Size | Weight | Line height | Tracking |
| --- | --- | --- | --- | --- | --- |
| `title-large` | heading | 72px | 700 | 120% | -0.04em |
| `title-medium` | heading | 64px | 700 | 120% | -0.04em |
| `title-small` | heading | 48px | 700 | 120% | -0.04em |
| `heading-large` | sans | 40px | 600 | 140% | -0.04em |
| `heading-medium` | sans | 32px | 600 | 140% | -0.04em |
| `heading-small` | sans | 24px | 600 | 140% | -0.04em |
| `body-large` | sans | 20px | 400 | 160% | -0.02em |
| `body-main` | sans | 16px | 400 | 160% | 0 |
| `body-main-medium` | sans | 16px | 600 | 1.6 | 0 |
| `body-small` | sans | 14px | 400 | 160% | 0.02em |
| `body-small-medium` | sans | 14px | 600 | 1.6 | 0 |
| `body-tiny` | sans | 12px | 400 | 160% | -0.02em |
| `caption` | sans | 12px | 400 | 1.2 | 0.08em |

## Radii

Radii override Tailwind defaults.

| Token | Value |
| --- | --- |
| `--radius-none` | 0 |
| `--radius-xs` | 2px |
| `--radius-sm` | 4px |
| `--radius-md` | 8px |
| `--radius-lg` | 12px |
| `--radius-xl` | 16px |
| `--radius-2xl` | 24px |
| `--radius-pill` | 9999px |

## Shadows

| Token | Value |
| --- | --- |
| `--shadow-1` | `0 1px 4px 0 rgba(0, 0, 0, 0.05)` |
| `--shadow-2` | `0 1px 4px 0 rgba(12, 12, 12, 0.05), 0 1px 4px 0 rgba(12, 12, 12, 0.1)` |
| `--shadow-3` | `0 4px 4px -1px rgba(12, 12, 13, 0.05), 0 4px 4px -1px rgba(12, 12, 13, 0.1)` |
| `--shadow-4` | `0 4px 4px -4px rgba(12, 12, 13, 0.05), 0 16px 32px -4px rgba(12, 12, 13, 0.1)` |
| `--shadow-5` | `0 4px 4px -4px rgba(12, 12, 13, 0.05), 0 16px 16px -8px rgba(12, 12, 13, 0.1)` |
| `--shadow-6` | `0 16px 32px -8px rgba(12, 12, 13, 0.4)` |
| `--shadow-7` | `0 -6px 5px -2px rgba(12, 12, 13, 0.05), 0 -4px 6px -4px rgba(12, 12, 13, 0.05)` |
| `--shadow-dark-3`, `--shadow-dark-5` | Darker variants of 3 and 5 |
| `--shadow-float-1`, `--shadow-float-2` | Semantic. Equal to shadow 3 and 5 in light mode, darker in dark mode |

## Spacing, size, and stroke

These have no Tailwind utilities.

- Spacing: `--space-0` 2px, `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-6` 24px, `--space-7` 32px, `--space-8` 40px, `--space-9` 48px, `--space-10` 56px, `--space-11` 64px.
- Size: `--size-12`, `-14`, `-16`, `-18`, `-20`, `-24`, `-32`, `-40`, `-48`, each equal to its number in px.
- Stroke: `--stroke-width-0`, `-point5` (0.5px), `-1`, `-2`, `-3`, `-4`.

## Surface classes

Defined in `packages/ui/styles/base.css`.

| Class | Background | Blur | Shadow |
| --- | --- | --- | --- |
| `.vellum` | `var(--card)` | `blur(14px) saturate(1.05)` | `var(--shadow-1)` |
| `.vellum-heavy` | `var(--popover)` | `blur(20px) saturate(1.08)` | `var(--shadow-1)` |
