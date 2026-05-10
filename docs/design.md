# Garden — Design System (Locked)

> Cultivated workshop on warm parchment — floating vellum panels with hairline edges, foliage-toned status palette, dotted-grid ground that reads as "structured space" peripherally. Productivity workspace warmth, not a developer tool, not an AI lab.

**Theme:** light

Garden's surfaces float on a warm parchment ground (`#f5f1e8`) overlaid with 4% film grain and a faint dotted grid (1.5px dots every 24px at 6% ink). UI panels sit above the ground as glass vellum (`bg-white/72 backdrop-blur-xl`), with hairline inset shadows replacing every drop-shadow. The shell is intentionally *disconnected* — sidebar rail, context rail, and dock content area each float with breathing room around them so the atmosphere shows through, never snapping flush to the viewport. Type is Geist for UI, DM Serif Text for agent prose, Geist Mono for code. Brand expression lives in the warm Moss green and the foliage status palette (Sage / Moss / Amber / Clay / Stone), not in saturated accents. Every interactive element is a pill (`9999px`) except inputs (`6px`); cards 16px, panels 20px, modals 24px. Nothing in the system reads as square or hard.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Parchment | `#f9f7f2` | `--color-parchment` | Page ground beneath the atmosphere layers — near-white with subtle warmth |
| Parchment Deep | `#efebe1` | `--color-parchment-deep` | Hover surfaces, secondary panels |
| Vellum | `rgba(255, 255, 255, 0.74)` | `--color-vellum` | Default glass card / panel surface — pure-white tint over parchment |
| Vellum Heavy | `rgba(255, 255, 255, 0.92)` | `--color-vellum-heavy` | Sidebar active row, modals |
| Bone | `#ffffff` | `--color-bone` | Inputs, active dock tab, modal interiors — true white |
| Ink | `#1a1f1c` | `--color-ink` | Primary text, primary CTA fill |
| Gravel | `#5b554d` | `--color-gravel` | Secondary text, captions, labels |
| Slate | `#8a8478` | `--color-slate` | Tertiary text, icon strokes at rest |
| Stone | `#a8a195` | `--color-stone` | Placeholder, offline status |
| Hairline | `rgba(26, 31, 28, 0.10)` | `--color-hairline` | Universal border value |
| Hairline Soft | `rgba(26, 31, 28, 0.06)` | `--color-hairline-soft` | Inset rings on glass-on-glass |
| Moss | `#4d7250` | `--color-moss` | Brand green, "ready/idle" status |
| Sage | `#7a9b6f` | `--color-sage` | "Working/alive" status |
| Amber | `#c89a4a` | `--color-amber` | "Blocked" status, warning |
| Clay | `#b56b4a` | `--color-clay` | "Error" status, destructive |
| Lichen | `#a8b89a` | `--color-lichen` | Pastel category tag |
| Lavender Mist | `#c5b8d4` | `--color-lavender-mist` | Pastel category tag |
| Peach | `#e8c8a8` | `--color-peach` | Pastel category tag |
| Dusk Rose | `#d8b4a8` | `--color-dusk-rose` | Pastel category tag |

## Tokens — Typography

Three fonts, three roles. All free, all Google Fonts.

### Geist Sans — All product UI: sidebar labels, dashboard text, buttons, navigation, page titles. Single sans family from 11px to 28px. Body uses 400 weight; emphasis and titles use 500-600 with tightened tracking. · `--font-sans`
- **Weights:** 400, 500, 600
- **Sizes:** 11, 12, 13, 14, 15, 16, 18, 22, 26
- **Tracking:** +0.005em at 11-13px, normal at 14-16px, -0.015em at 18px, -0.02em at 22px+
- **Role:** Every UI label, body paragraph, button text, tab title, sidebar row, dashboard metric, table cell.

### DM Serif Text — Agent markdown prose. Chat message body, issue descriptions, comments — anywhere an agent has written paragraphs for a human to read. Gives the agent's voice considered weight without going Klim/Anthropic. Applied via the `.is-assistant` class on the message bubble. · `--font-prose`
- **Weights:** 400
- **Sizes:** 15.5px (chat body), 16 (issue prose), 18 (lead paragraph)
- **Line height:** 1.6
- **Letter spacing:** +0.005em (subtle open tracking for legibility on parchment)
- **Role:** Only inside agent-authored content surfaces. The `.is-assistant` rule sets font-family on the message; headings/buttons/inputs/code inside that scope revert to sans/mono so structural UI elements stay consistent. Never UI labels, never buttons, never tabs.

### Geist Mono — Code blocks, inline code, file paths, tool names, agent IDs, durations. The 5-10% of text that's machine-output or stable identifiers. · `--font-mono`
- **Weights:** 400, 500
- **Sizes:** 12, 13
- **Role:** `bash`, `pnpm install`, `2.4s`, `agent_a3f...`, file tree leaves.

### Type Scale

| Role | Family | Weight | Size | Line | Tracking |
|------|--------|--------|------|------|----------|
| eyebrow | Sans | 500 | 11px | 1.4 | +0.16em uppercase |
| caption | Sans | 500 | 11px | 1.4 | +0.005em |
| meta | Sans | 400 | 12px | 1.45 | normal |
| body-sm | Sans | 400 | 13px | 1.5 | normal |
| body | Sans | 400 | 14px | 1.5 | normal |
| body-lg | Sans | 400 | 15px | 1.55 | normal |
| ui-heading | Sans | 500 | 16px | 1.4 | -0.01em |
| ui-heading-lg | Sans | 500 | 18px | 1.35 | -0.015em |
| heading-sm | Sans | 600 | 22px | 1.25 | -0.02em |
| heading | Sans | 600 | 26px | 1.2 | -0.022em |
| prose-body | Serif | 400 | 16px | 1.6 | normal |
| code | Mono | 400 | 13px | 1.55 | normal |

## Tokens — Shape

Restrained, Linear/Cursor-tier radii scale. Containers stay soft, not pillowy. Pill (`9999px`) reserved for small textual chips only (status badges, foliage tags) — never for buttons or tabs.

| Element | Radius | Token |
|---|---|---|
| Inputs | 6px | `--radius-input` |
| Buttons / tabs | 8px | `--radius-button` / `--radius-tab` |
| Small cards | 10px | `--radius-lg` |
| Cards (default) | 12px | `--radius-card` |
| Panels / rails / sidebar | 14px | `--radius-panel` |
| Modals / sheets | 18px | `--radius-modal` |
| Status chips / badges / avatars | 9999px | `rounded-full` |

**Rule:** the scale is 6 → 8 → 10 → 12 → 14 → 18 → 24. Pill (9999px) is for small textual indicators only. Buttons are soft 8px rectangles. Tabs use 8px on top corners only (the bottom is flat where the active tab docks into the work area).

## Tokens — Elevation

Hairline only. No drop-shadow elevation anywhere.

| Token | Recipe | Use |
|-------|--------|-----|
| `--shadow-hairline` | `rgba(26, 31, 28, 0.10) 0px 0px 0px 0.5px inset` | Every vellum card |
| `--shadow-hairline-soft` | `rgba(26, 31, 28, 0.06) 0px 0px 0px 0.5px inset` | Glass-on-glass nested |
| `--shadow-float-1` | `rgba(26, 31, 28, 0.06) 0px 0px 0px 0.5px, rgba(26, 31, 28, 0.04) 0px 1px 1px` | Popovers only |
| `--shadow-float-2` | `rgba(26, 31, 28, 0.06) 0px 0px 0px 0.5px, rgba(26, 31, 28, 0.06) 0px 4px 12px` | Modals only |

## Atmospheric Ground

Applied once on `<body>`. Just parchment + film grain — no geometric pattern, no gradients, no animation. The grain alone gives the surface tooth and reads as paper.

```css
body {
  background-color: var(--color-parchment);
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.78' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.06'/></svg>");
  background-size: 220px 220px;
  background-attachment: fixed;
  background-blend-mode: multiply;
}
```

No gradients. No dotted/hatched/laid patterns. No breathing animation. Just paper.

## Shell — floating glass panels

The shell is two floating glass regions: a sidebar (rail + context rail combined inside a single 14px-rounded vellum panel with internal hairline divider) and a dock content area (own 14px-rounded vellum panel). The parchment ground shows through the gap between them.

| Region | Width | Margin | Surface | Radius |
|---|---|---|---|---|
| Sidebar panel (rail + context rail) | 48 + 240px | 8px viewport | Vellum + blur-xl | 14px outer, hairline-soft divider between rail and context rail |
| Dock content area | 1fr | 8px viewport (0 left, abuts sidebar via 8px gap) | Vellum + blur-xl | 14px |
| Tab strip (inside dock) | full × 38px | 6px horizontal padding | Transparent + hairline bottom border | n/a (active tabs round only on top corners) |

Gap between sidebar and dock: 8px. Margins from viewport edge: 8px. Atmosphere shows through every gap.

Inner rails inside the sidebar panel are *not* their own glass panels — they share the sidebar's glass surface. A single hairline-soft `border-r` between them is the only divider. This is the cohesion move: the sidebar reads as one panel with two columns, not two panels stacked.

## Components

### Pill Button (Filled Ink — primary CTA)
`bg-ink text-parchment rounded-full px-4 h-8` + hairline inset. Hover lightens to `#2a2f2c`. Focus ring 2px Moss at 40%.

### Pill Button (Brand Moss — create-new affordances)
`bg-moss text-parchment rounded-full px-4 h-8`. Reserved for "New chat", "New agent", "New issue". Never two brand pills in one cluster.

### Pill Button (Ghost Vellum — secondary)
`bg-white/55 backdrop-blur-md text-ink rounded-full px-3 h-7` + hairline-soft inset. Hover alpha rises to 0.72.

### Soft-Tab (dock tabs — punch-through pattern)
Tabs sit at the bottom of a 38px tab strip. The strip has a 1px hairline bottom border (the "tab rail line"). Inactive tabs are silent: transparent bg, gravel text, rounded-top corners only (`8px 8px 0 0`). Hover: ink-wash at 5%. **Active** tab is solid `bone` (pure white) with hairline ring on top + left + right edges, and extends 1px below the tab strip via `margin-bottom: -1px` — visually punching through the strip border to "dock" into the work area. No bottom border on the active tab. The bone solid-fill creates the highest-contrast moment in the shell — clearly the currently-viewed surface.

### Status Pill (Foliage Badge)
`inline-flex gap-1.5 items-center rounded-full px-2 h-5 bg-white/45 backdrop-blur-sm` + hairline-soft inset. Leading 6px dot in Sage / Moss / Amber / Clay / Stone. Label Sans 500 11px gravel lowercase.

### Foliage Dot (bare status, dense lists)
6px dot in foliage color with 2px ring of surrounding surface for lift.

### Vellum Card
`bg-vellum backdrop-blur-xl rounded-2xl p-5` + `--shadow-hairline`. Default panel for content.

### Glass Sheet (modal)
`bg-vellum-heavy backdrop-blur-2xl rounded-3xl p-7` + `--shadow-float-2`. Centered with `bg-ink/18` scrim.

### Editorial Input (underlined)
`bg-transparent rounded-none border-b border-hairline px-0 py-2`. Focus: border-b becomes 1px ink. The sharp-edge counterpoint to the pill system.

### Contained Input (vellum)
`bg-bone rounded-md h-8 px-3` + hairline inset. Focus: inset ring switches to 1.5px Moss at 50%.

### Foliage Tag (category chip)
`inline-flex rounded-full px-2.5 h-5.5 bg-{lichen|lavender|peach|dusk}/30 text-{darker-tone}` + Sans 500 11px lowercase.

## Do's and Don'ts

### Do
- Apply atmospheric ground to `<body>` once. Every panel above it uses Vellum + backdrop-blur.
- Use Geist Sans 400 at body, 500 for emphasis/labels, 600 for headings. Tighten tracking proportionally with size.
- Reserve DM Serif Text for agent-authored markdown content only — chat messages, issue descriptions, comments.
- Use `rounded-full` (9999px) on every interactive element. Use 16/20/24 on containers.
- Reserve Moss for "create-new" CTAs and "ready" status. Use Ink for default CTA.
- Foliage status palette (Sage/Moss/Amber/Clay/Stone) for all status indicators across the system.
- Float shell regions with 12px viewport margin + 8px inter-region gaps so atmosphere shows through.
- Replace all per-component opacity values (`/40`, `/60`, `/70`) with `--color-hairline` (10%) or `--color-hairline-soft` (6%).

### Don't
- Never use dark / midnight backgrounds. Light is canonical.
- Never use a font outside the three locked roles. No serif on UI buttons. No mono in body. No sans in agent prose.
- Never apply small radii (2–8px) to interactive elements except inputs.
- Never use pure white `#ffffff` as a page or panel background. Use Parchment or Vellum.
- Never use drop-shadow elevation larger than `0px 4px 12px` (Float-2).
- Never introduce gradients (radial, linear, conic) as atmosphere or fills. Pattern only.
- Never use bright crayola accents (coral, fuchsia, hot pink). Foliage palette + 4 pastel tags is the entire color system.
- Never snap shell regions flush to the viewport edge. Disconnected floating panels with breathing room.

## Active-State Vocabulary (Cohesion Rule)

Every active state across the shell uses the same recipe so the visual language is unified:

| Surface | Inactive | Hover | Active |
|---|---|---|---|
| Outer rail icon (8×8 button) | `text-slate` | `bg-ink/4 text-ink` | `bg-vellum-heavy text-ink + inset 0.5px hairline ring` |
| Context rail row | `text-foreground` (default) | `bg-ink/4` | `bg-vellum-heavy text-ink font-medium + inset 0.5px hairline ring` |
| Dock tab | `text-gravel` | `bg-ink/5 text-ink` | `bg-bone text-ink + inset 1px hairline on top+left+right (punches through tab strip)` |

The tab active state differs slightly (solid bone vs vellum-heavy) because tabs have higher salience — the user needs to know at a glance which surface they're currently viewing. Sidebar rows are secondary navigation; they get the softer vellum-heavy treatment.

## Quick Start

### Font Imports
```html
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=DM+Serif+Text&display=swap" rel="stylesheet">
```

### CSS Custom Properties
```css
:root {
  /* Surfaces */
  --color-parchment: #f9f7f2;
  --color-parchment-deep: #efebe1;
  --color-vellum: rgba(255, 255, 255, 0.74);
  --color-vellum-heavy: rgba(255, 255, 255, 0.92);
  --color-bone: #ffffff;

  /* Text */
  --color-ink: #1a1f1c;
  --color-gravel: #5b554d;
  --color-slate: #8a8478;
  --color-stone: #a8a195;

  /* Hairlines */
  --color-hairline: rgba(26, 31, 28, 0.10);
  --color-hairline-soft: rgba(26, 31, 28, 0.06);

  /* Brand + foliage */
  --color-moss: #4d7250;
  --color-sage: #7a9b6f;
  --color-amber: #c89a4a;
  --color-clay: #b56b4a;

  /* Pastel tags */
  --color-lichen: #a8b89a;
  --color-lavender-mist: #c5b8d4;
  --color-peach: #e8c8a8;
  --color-dusk-rose: #d8b4a8;

  /* Typography */
  --font-sans: 'Geist', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-prose: 'DM Serif Text', Georgia, serif;
  --font-mono: 'Geist Mono', ui-monospace, monospace;

  /* Radii — Linear-tier restraint */
  --radius-input: 6px;
  --radius-button: 8px;
  --radius-tab: 8px;
  --radius-card: 12px;
  --radius-panel: 14px;
  --radius-modal: 18px;
  /* Pill (9999px) only for status chips, badges, avatars — via Tailwind's
     rounded-full utility. Buttons are soft 8px rectangles, not pills. */

  /* Shadows */
  --shadow-hairline: rgba(26, 31, 28, 0.10) 0px 0px 0px 0.5px inset;
  --shadow-hairline-soft: rgba(26, 31, 28, 0.06) 0px 0px 0px 0.5px inset;
  --shadow-float-1: rgba(26, 31, 28, 0.06) 0px 0px 0px 0.5px, rgba(26, 31, 28, 0.04) 0px 1px 1px;
  --shadow-float-2: rgba(26, 31, 28, 0.06) 0px 0px 0px 0.5px, rgba(26, 31, 28, 0.06) 0px 4px 12px;

  /* Shell */
  --shell-rail: 56px;
  --shell-context-rail: 256px;
  --shell-titlebar: 44px;
  --shell-margin: 12px;
  --shell-gap: 8px;

  /* Motion */
  --motion-base: 200ms ease;
  --motion-tab: 240ms ease;
}
```

## Out of scope for this build pass

- Dashboard interior (cards/charts) — light rearrangement only
- Onboarding visuals
- Empty states
- Mobile adaptation
- Dark mode
