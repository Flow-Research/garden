# Garden — Vibe Lock

> Cultivated workshop at golden hour. A grainy parchment ground tinted with cool sage, four pastel atmospheric washes drifting behind glassmorphic vellum panels, a light-weight serif whispering against precise UI body type. Editorial restraint with warmth — not severe, not cartoon. The room a human and their agents quietly work in.

This doc locks the direction. Anything outside it should bounce off this page first.

## Out

- Notion / midnight indigo. Dropped.
- Bright crayola accent palette (Notion's coral/fuchsia/yellow). Dropped.
- Square tabs, 2-6px radii on interactive elements, hard borders as primary divider system. Dropped.
- Pure white (`#ffffff`) page surfaces. Dropped — eggshell/parchment ground only.
- Heavy drop-shadow elevation. Dropped — hairline + glass only.

## In, and where it comes from

| Source | What we take |
|---|---|
| **ElevenLabs** | Type-first restraint. Light-weight (300) display serif. Single chromatic accent reserved for tiny indicators. Pill CTAs (9999px). Hairline inset shadow as the elevation system. Editorial section rhythm. |
| **Superhuman** | Parchment canvas (`#f2f0eb` warmth). Glassmorphic floating panels with `backdrop-filter: blur(12px)`. Atmospheric radial gradients drifting behind UI. Tight negative letter-spacing on display sizes. Cinematic depth via overlap, not drop-shadow. |
| **Existing Garden** | The green brand `oklch(0.62 0.16 145)` stays. Status-dot system (sage/amber/clay/stone). The two-rail sidebar shell. |
| **Garden personality** | Cultivation, tending, lived-in. Status as foliage palette. "Workshop" not "control panel." Grainy texture (film grain on parchment). |

## Atmosphere — non-plain backgrounds

The page is never a flat fill. Every surface sits on a layered ground:

1. **Parchment** — `oklch(0.97 0.01 95)` warm cream as the base.
2. **Grain** — SVG turbulence noise overlay at 3–5% opacity, fixed-position, multiply-blend. One layer, page-wide.
3. **Atmospheric washes** — four radial gradients drifting at low opacity (~0.18–0.28), positioned at the four corners. Pastel garden palette: sage, lavender-mist, peach, dusk-rose. Slow rotation animation (60–120s loop) so the room "breathes."
4. **Vellum panels** — UI sits on white-alpha cards (`rgba(255, 252, 247, 0.72)`) with `backdrop-filter: blur(14px) saturate(1.05)`. The grain and washes show through.

```css
/* atmosphere */
--atmosphere-sage:    radial-gradient(60% 40% at 12% 18%, oklch(0.92 0.05 145 / 0.22), transparent 70%);
--atmosphere-lavender:radial-gradient(50% 35% at 88% 22%, oklch(0.90 0.05 290 / 0.18), transparent 72%);
--atmosphere-peach:   radial-gradient(55% 38% at 18% 88%, oklch(0.93 0.06 60  / 0.20), transparent 70%);
--atmosphere-dusk:    radial-gradient(48% 36% at 90% 84%, oklch(0.91 0.06 25  / 0.18), transparent 72%);

/* applied as stacked backgrounds on body */
body {
  background:
    var(--atmosphere-sage),
    var(--atmosphere-lavender),
    var(--atmosphere-peach),
    var(--atmosphere-dusk),
    url("data:image/svg+xml,…feTurbulence…") /* grain, ~4% opacity */,
    var(--parchment); /* base */
}
```

## Glass — the vellum system

Glass is the primary surface for any panel that floats over the atmosphere (sidebar, dock tabstrips, popovers, modals). Three weights:

| Weight | Use | Recipe |
|---|---|---|
| Heavy | Modals, settings sheets | `bg-white/80 backdrop-blur-2xl saturate-105`, hairline ring `0 0 0 0.5px rgba(0,0,0,0.08) inset` |
| Medium | Sidebar context rail, dock tabstrip, popovers | `bg-white/72 backdrop-blur-xl saturate-105`, hairline ring `0 0 0 0.5px rgba(0,0,0,0.06) inset` |
| Light | Pill chips, status badges, hover states | `bg-white/55 backdrop-blur-md`, no ring |

No `box-shadow` drop elevation anywhere. Depth comes from blur + overlap, not from offset shadows.

## Color tokens (light)

Replace the current `:root[data-theme='garden']` block. Existing brand green keeps its hue, gets gentle saturation tune.

```css
:root[data-theme='garden'] {
  /* Surfaces */
  --parchment:        oklch(0.97 0.012 95);   /* warm cream base */
  --parchment-deep:   oklch(0.94 0.014 95);   /* hover/secondary surface */
  --vellum:           oklch(1 0 0 / 0.72);    /* glass card alpha */
  --ink:              oklch(0.22 0.012 145);  /* primary text — green-tinted near-black */
  --gravel:           oklch(0.50 0.010 90);   /* secondary text, warm stone */
  --slate:            oklch(0.65 0.008 95);   /* tertiary, deemphasized */
  --hairline:         oklch(0.22 0.012 145 / 0.10); /* 1px borders, only when needed */

  /* Brand & status — earthy garden palette */
  --brand:            oklch(0.58 0.13 148);   /* signature warm green, slightly less saturated */
  --brand-fg:         oklch(0.98 0.005 95);
  --sage:             oklch(0.72 0.09 145);   /* "working" — alive */
  --moss:             oklch(0.55 0.08 150);   /* "ready/idle" — settled */
  --amber:            oklch(0.78 0.13 75);    /* "blocked" — needs attention */
  --clay:             oklch(0.62 0.14 35);    /* "error" — warm urgency, not red */
  --stone:            oklch(0.68 0.005 95);   /* "offline" — quiet */

  /* Atmospheric washes — see Atmosphere section above */

  /* Map to shadcn token contract */
  --background:       transparent; /* atmosphere on body, not opaque fill */
  --foreground:       var(--ink);
  --card:             var(--vellum);
  --card-foreground:  var(--ink);
  --popover:          var(--vellum);
  --popover-foreground: var(--ink);
  --primary:          var(--ink);  /* primary CTA = filled black-ish pill */
  --primary-foreground: var(--parchment);
  --secondary:        var(--parchment-deep);
  --secondary-foreground: var(--ink);
  --muted:            var(--parchment-deep);
  --muted-foreground: var(--gravel);
  --accent:           var(--parchment-deep);
  --accent-foreground: var(--ink);
  --destructive:      var(--clay);
  --border:           var(--hairline);
  --input:            var(--hairline);
  --ring:             var(--brand);
  --success:          var(--sage);
  --warning:          var(--amber);
  --info:             oklch(0.65 0.10 240);
  --priority:         var(--clay);

  /* Sidebar — uses vellum so atmosphere shows through */
  --sidebar:          var(--vellum);
  --sidebar-foreground: var(--ink);
  --sidebar-primary:  var(--brand);
  --sidebar-primary-foreground: var(--brand-fg);
  --sidebar-accent:   oklch(1 0 0 / 0.55);
  --sidebar-accent-foreground: var(--ink);
  --sidebar-border:   var(--hairline);
  --sidebar-ring:     var(--brand);
}
```

Dark mode comes later. Light is canonical.

## Typography

| Role | Font | Weight | Size scale | Tracking |
|---|---|---|---|---|
| Display | **Fraunces** (variable, free) | 300 | 32 / 40 / 56 / 72 | -0.02em |
| Section heading | Fraunces | 300 | 22 / 26 | -0.015em |
| UI heading | Inter | 500 | 14 / 16 / 18 | -0.005em |
| Body | Inter | 400 | 13 / 14 / 15 | normal |
| Eyebrow / metadata | Inter | 500 (uppercase) | 10 / 11 | 0.16em |
| Mono | Geist Mono | 400 | 12 / 13 | normal |

**Why Fraunces over Waldenburg**: Waldenburg is paid Lineto. Fraunces is variable, free, has optical sizes (`opsz`) and a `SOFT` axis we can lean on for warmth. It carries the same "light-weight serif against utility sans" gesture as ElevenLabs without the $700 license. Cormorant Garamond is the fallback if Fraunces ever feels too contemporary.

```css
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT@9..144,300..500,0..100&family=Inter:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap');

:root {
  --font-display: 'Fraunces', ui-serif, Georgia, serif;
  --font-sans:    'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono:    'Geist Mono', ui-monospace, monospace;
}

/* Fraunces variable axis settings — calibrate the warmth */
.font-display {
  font-family: var(--font-display);
  font-variation-settings: 'opsz' 96, 'SOFT' 60;
  letter-spacing: -0.02em;
}
```

## Shape — the soft scale

Replace the current radius scale (which compounds from `--radius: 0.625rem` and produces 6/8/10/14/18/22/26 px). The new scale is intentionally generous so nothing reads as "block".

| Token | Value | Use |
|---|---|---|
| `--radius-input` | 6px | Form inputs only (the editorial sharp note). |
| `--radius-chip` | 9999px | Tags, status pills, kebab buttons, icon buttons. |
| `--radius-tab` | 9999px | Dock tabs (active state pill). |
| `--radius-card` | 16px | Standard cards, popovers, dropdowns. |
| `--radius-panel` | 20px | Context rail outer corners, sidebar rail outer corners. |
| `--radius-modal` | 24px | Dialogs, sheets. |
| `--radius-button` | 9999px | All buttons. |

**Rule**: any interactive element that isn't an input → fully rounded pill. Containers use 16/20/24. Inputs are the only place a small radius appears.

## Motion

- Base transition: 200ms `ease` on color / background / border / shadow / blur.
- Layout/size: 280ms `ease`.
- The atmospheric washes loop slowly (60–120s, ease-in-out, alternate) so the room breathes.
- Tab activation: 240ms with a tiny scale dip (`0.985 → 1.0`) on the new active pill.
- No spring overshoot in production UI — save springs for the onboarding visuals.

## Shell mapping — what changes (and only what changes)

This is what we'll actually touch in the next pass. Three surfaces:

### 1. Sidebar — outer rail (icon strip)

**Now**: 48px-wide icon column, square buttons (`!rounded-none`), border-r, opaque sidebar background.

**Vibe**:
- Vellum surface (transparent over atmosphere).
- Active rail icon: full-pill highlight (32×32, `rounded-full`, `bg-white/65 backdrop-blur-md`, hairline inset).
- Inactive: `text-gravel`, no background. Hover: `bg-white/35`.
- The brand mark at top: keep, but the chip behind it becomes a vellum pill.
- Border-r becomes a hairline `border-r-hairline`, half-strength.

### 2. Sidebar — context rail (inner)

**Now**: opaque inner sidebar with `border-r-sidebar-border/70`, square menu rows, uppercase `[10px]` tracked labels.

**Vibe**:
- Same vellum surface; the rail "floats" off the rail-strip via overlapping atmosphere.
- Outer right corner: `rounded-tr-panel rounded-br-panel` (20px) so the rail visually softens into the canvas.
- Section labels: keep uppercase tracked, restyle as `font-display` 11px Fraunces 400 — gives the label a tiny serif lift instead of standard sans uppercase.
- Menu rows: `rounded-full` pill highlight on active. Active = `bg-white/72 backdrop-blur` + `text-ink`. Hover = `bg-white/40`.
- Replace the search trigger `Input` with a transparent input pinned by a hairline bottom-border (ElevenLabs editorial input).

### 3. Dock tabstrip + tabs

**Now**: FlexLayout tabs at 34px, 6px radius, font-size 12px, muted background gradient.

**Vibe**:
- Tabstrip background: vellum with stronger blur (`backdrop-blur-2xl`).
- Tab radius: keep 6px on the *underlying* FlexLayout group (FlexLayout needs it), but the tab *content* rendered inside `WorkspaceDockTab` becomes a `rounded-full` pill that sits inset 4px on each side.
- Inactive tab: `text-gravel`, transparent background.
- Active tab: `bg-white/85 backdrop-blur-md`, `text-ink`, hairline inset, slight pill scale-in animation on activation.
- Tab close button: `rounded-full`, hover `bg-white/50`.
- Tabstrip actions (kebab, plus): `rounded-full` 24×24 chips.

### 4. Workspace titlebar

**Now**: `WorkspaceDockTitlebar` shows workspace name + subtitle on a flat background.

**Vibe**:
- Heavy glass: `bg-white/82 backdrop-blur-2xl saturate-105`, hairline bottom inset shadow.
- Workspace name: Fraunces 300, 18px, tracking -0.01em.
- Subtitle: Inter 400, 12px, `text-gravel`.
- Replace any breadcrumb chevrons (Lucide `ChevronRight`) with a thin Fraunces middot `·` so the type carries the separator.

## Component recipes

### Pill button — primary
```
bg-ink text-parchment rounded-full px-4 h-8 text-[14px] font-medium
hairline inset, hover: bg-ink/92, focus-visible: ring brand at 40%
```

### Pill button — ghost
```
bg-white/55 backdrop-blur-md text-ink rounded-full px-3 h-7 text-[13px] font-medium
hairline inset, hover: bg-white/72
```

### Status pill (replaces current dot+badge combos)
```
inline-flex gap-1.5 items-center rounded-full px-2 h-5 text-[11px]
bg-white/45 backdrop-blur-sm + 1.5px dot in {sage|amber|clay|stone|moss}
```

### Glass card
```
bg-vellum (white/72) backdrop-blur-xl saturate-105 rounded-card (16px)
ring: 0 0 0 0.5px rgba(0,0,0,0.06) inset
no drop shadow.
```

### Editorial input
```
bg-transparent rounded-input (6px) border-b border-hairline
focus: border-b-ink, no ring
font-sans 14px, placeholder text-slate
```

## Out of scope for this first pass

- Dashboard interior (cards/charts) — comes after shell aligns.
- Onboarding visuals — Remotion + image-gen pass after vibe is locked.
- Empty states — separate pass.
- Mobile adaptation — design is desktop-first; mobile gets `adapt` later.
- Dark mode — light is canonical for now.

## Open questions before we start

1. **Brand green saturation** — current is `oklch(0.62 0.16 145)`. New proposed `oklch(0.58 0.13 148)` — slightly deeper, slightly softer. OK to nudge?
2. **Grain intensity** — 3% (barely there) vs 5% (visible texture). Default to 3% unless you want it grainier on screenshot.
3. **Atmosphere motion** — breathing loop on by default (`prefers-reduced-motion` disables). OK or static?
4. **Fraunces SOFT axis** — `60` gives a humanist warmth. `0` is more classical. Which way?

Once these are answered the shell migration starts in a fresh worktree, scoped to:

1. Token rewrite (`packages/ui/styles/tokens.css`).
2. Atmosphere layer (`packages/ui/styles/base.css`).
3. Sidebar + context rail (`apps/web/src/components/shell/sidebar.tsx`).
4. Dock theming (`apps/web/src/custom.css` + `workspace-dock.tsx` tab renderer).
5. Titlebar.

Nothing else gets touched in pass one.
