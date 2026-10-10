#!/usr/bin/env node
/**
 * Generates `packages/ui/styles/tokens.css` from `packages/ui/tokens/tokens.json`
 * (Tokens Studio export — the new design-system source of truth).
 *
 * Why this exists: the design overhaul replaces the hand-authored parchment-era
 * tokens.css with a generated file so token re-exports stay a one-command re-sync
 * instead of a manual merge. Regenerate with: pnpm --filter @garden/ui tokens:build
 *
 * Output architecture (mirrors the previous hand-authored file's proven pattern):
 *   1. `:root`      — primitive tokens (color scales, type atoms, spacing/size/
 *                     stroke spec vars, shadows, radii) + Light semantic set +
 *                     compat aliases (shadcn contract + legacy garden vocabulary).
 *                     Aliases reference semantic vars, so they flip with dark mode
 *                     for free and are NOT repeated in the dark block.
 *   2. `:root.dark` — Dark semantic set + scrollbar overrides only.
 *   3. `@theme inline` — Tailwind v4 utility bindings referencing the vars above
 *                     (inline mode inlines the var() expression into utilities, so
 *                     mode-flipping values resolve at use time).
 *   4. `@utility`   — composite typography tokens (heading-large, body-main, …)
 *                     emitted 1:1 as classes.
 *
 * Token-format handling notes (verified against the export):
 *   - Aliases (`{white.1000}`, `{font-size-3xl}`) resolve against the Global set.
 *   - `letter-spacing` values are unitless → emitted as `em`.
 *   - `radius-pill` and numeric stroke widths are unitless → emitted with `px`.
 *   - Shadow tokens are multi-layer arrays → joined into one box-shadow value.
 *   - Font-size/radius/tracking scales deliberately OVERRIDE Tailwind defaults
 *     where they disagree (text-lg 20px vs 18px, radius-md 8px vs 6px, …) — the
 *     token file is canonical.
 *   - CamelCase semantic keys (`onSuccess`, `onBrand`) flatten to kebab-case
 *     (`on-success`, `on-brand`).
 *
 * Compat layers (shadcn contract, legacy garden names) keep existing components
 * compiling while the component sweep migrates usages; legacy aliases are deleted
 * at the end of the sweep. See docs/design.md and the phase plan in git history.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '../../..')
const tokensPath = join(here, '../tokens/tokens.json')
const outPath = join(here, '../styles/tokens.css')

const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'))
const { Global, Light, Dark } = tokens

/** Converts Tokens Studio keys to CSS-safe kebab-case (`onSuccess` → `on-success`). */
function kebab(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/** Flattens a token set into `{ path, token }` leaves (`background.main.default` → `background-main-default`). */
function flatten(set, prefix = []) {
  const out = []
  for (const [key, value] of Object.entries(set)) {
    if (key.startsWith('$')) continue
    if (value && typeof value === 'object' && '$value' in value) {
      out.push({ path: [...prefix, kebab(key)].join('-'), token: value })
    } else if (value && typeof value === 'object') {
      out.push(...flatten(value, [...prefix, kebab(key)]))
    }
  }
  return out
}

const globalByPath = new Map(
  flatten(Global).map((entry) => [entry.path, entry.token]),
)

const ALIAS_RE = /^\{(.+)\}$/

/** Resolves `{dot.path}` aliases against the Global set, with cycle detection. */
function resolveAlias(value, seen) {
  if (typeof value !== 'string') return value
  const match = ALIAS_RE.exec(value)
  if (!match) return value
  const path = match[1].split('.').map(kebab).join('-')
  if (seen.has(path)) throw new Error(`Alias cycle detected at ${path}`)
  const target = globalByPath.get(path)
  if (!target) throw new Error(`Unresolved alias {${match[1]}}`)
  return resolveValue(target, new Set([...seen, path]))
}

const NUMERIC = /^-?\d+(\.\d+)?$/
const WITH_UNIT = /^-?\d+(\.\d+)?(px|rem|em|%)$/

/** Adds `px` to bare numbers (`9999` → `9999px`); passes through values that already carry a unit. */
function px(value) {
  if (typeof value === 'number') return value === 0 ? '0' : `${value}px`
  if (NUMERIC.test(value)) return Number(value) === 0 ? '0' : `${value}px`
  if (WITH_UNIT.test(value)) return value
  throw new Error(`Cannot normalize length value: ${value}`)
}

/** Adds `em` to unitless letter-spacing values (`-0.04` → `-0.04em`). */
function em(value) {
  return NUMERIC.test(value) && Number(value) !== 0
    ? `${value}em`
    : String(value)
}

/** Serializes one shadow layer to standard box-shadow order: offsets, blur, spread, color, inset. */
function shadowLayer(layer) {
  const parts = [
    px(layer.offsetX),
    px(layer.offsetY),
    px(layer.blur),
    px(layer.spread),
    layer.color,
  ]
  if (layer.inset) parts.push('inset')
  return parts.join(' ')
}

/** Resolves a token's `$value` to a CSS string according to its `$type`. */
function resolveValue(token, seen = new Set()) {
  const value = token.$value
  switch (token.$type) {
    case 'color': {
      const resolved = resolveAlias(value, seen)
      // Lowercase hex to match oxfmt output — keeps regen byte-identical after formatting.
      return resolved.startsWith('#') ? resolved.toLowerCase() : resolved
    }
    case 'fontSizes':
    case 'sizing':
    case 'spacing':
    case 'borderRadius':
    case 'borderWidth':
      return px(resolveAlias(value, seen))
    case 'letterSpacing':
      return em(resolveAlias(value, seen))
    case 'fontWeights':
      return String(resolveAlias(value, seen))
    case 'fontFamilies':
      return value.map((family) => `'${resolveAlias(family, seen)}'`).join(', ')
    case 'lineHeights':
    case 'textCase':
    case 'textDecoration':
      return resolveAlias(value, seen)
    case 'shadow': {
      // Semantic shadow tokens alias Global shadows (`{shadow-5}`); the alias
      // resolver returns the target's already-serialized box-shadow string.
      const resolved =
        typeof value === 'string' ? resolveAlias(value, seen) : value
      return typeof resolved === 'string'
        ? resolved
        : resolved.map(shadowLayer).join(', ')
    }
    case 'typography':
      return value // composites are emitted separately as @utility classes
    default:
      throw new Error(`Unknown $type: ${token.$type}`)
  }
}

/** Maps token font families onto the app-owned stacks (Phase 1 wires the real faces). */
const FAMILY_VAR = {
  inter: 'var(--font-sans)',
  'cabinet-grotesk': 'var(--font-heading)',
}

/** Renders a composite typography token (`heading-large`, `caption`, …) as a Tailwind v4 @utility. */
function typographyUtility(name, value) {
  const lines = []
  const families = value.fontFamilies?.map((f) => {
    const key = ALIAS_RE.test(f) ? f.slice(1, -1) : f
    return FAMILY_VAR[key] ?? `'${key}'`
  })
  if (families?.length) lines.push(`font-family: ${families.join(', ')}`)
  if (value.fontSizes)
    lines.push(
      `font-size: ${resolveValue({ $type: 'fontSizes', $value: value.fontSizes })}`,
    )
  if (value.fontWeights)
    lines.push(
      `font-weight: ${resolveValue({ $type: 'fontWeights', $value: value.fontWeights })}`,
    )
  if (value.lineHeights) lines.push(`line-height: ${value.lineHeights}`)
  if (value.letterSpacing)
    lines.push(
      `letter-spacing: ${resolveValue({ $type: 'letterSpacing', $value: value.letterSpacing })}`,
    )
  if (value.textCase) lines.push(`text-transform: ${value.textCase}`)
  return `@utility ${name} {\n  ${lines.join(';\n  ')};\n}`
}

const globalFlat = flatten(Global)
const lightFlat = flatten(Light)
const darkFlat = flatten(Dark)

const byType = (entries, type) => entries.filter((e) => e.token.$type === type)
const varLine = (name, value) => `  --${name}: ${value};`

// Fail loudly if a token re-export introduces a $type this generator doesn't
// handle — partitioning below would otherwise silently drop those tokens.
const KNOWN_GLOBAL_TYPES = new Set([
  'color',
  'fontSizes',
  'letterSpacing',
  'borderRadius',
  'shadow',
  'spacing',
  'sizing',
  'borderWidth',
  'typography',
  // Deliberately not emitted: weights match Tailwind defaults, family atoms are
  // wired via @utility composites, case/decoration atoms only appear in composites.
  'fontWeights',
  'fontFamilies',
  'textCase',
  'textDecoration',
])
for (const e of globalFlat) {
  if (!KNOWN_GLOBAL_TYPES.has(e.token.$type)) {
    throw new Error(
      `Unhandled Global $type '${e.token.$type}' at ${e.path} — extend build-tokens.mjs`,
    )
  }
}

// --- Partition Global primitives -------------------------------------------------
const primitiveColors = byType(globalFlat, 'color')
const fontSizes = byType(globalFlat, 'fontSizes')
const letterSpacings = byType(globalFlat, 'letterSpacing')
const radii = byType(globalFlat, 'borderRadius')
const shadows = byType(globalFlat, 'shadow')
const spacings = byType(globalFlat, 'spacing')
const sizings = byType(globalFlat, 'sizing')
const strokeWidths = byType(globalFlat, 'borderWidth')
const typographies = byType(globalFlat, 'typography')

// --- Compat layers ---------------------------------------------------------------
// shadcn contract: maps the load-bearing component API onto new semantic tokens.
// Single :root definition — references semantic vars, so dark mode flips for free.
const SHADCN_COMPAT = {
  background: 'var(--background-main-default)',
  foreground: 'var(--text-neutral-default)',
  card: 'var(--background-main-default)',
  'card-foreground': 'var(--text-neutral-default)',
  popover: 'var(--background-main-default)',
  'popover-foreground': 'var(--text-neutral-default)',
  primary: 'var(--background-brand-default)',
  'primary-foreground': 'var(--text-brand-on-brand)',
  secondary: 'var(--background-neutral-secondary)',
  'secondary-foreground': 'var(--text-neutral-on-neutral-secondary)',
  muted: 'var(--background-main-secondary)',
  'muted-foreground': 'var(--text-neutral-secondary)',
  accent: 'var(--background-main-secondary)',
  'accent-foreground': 'var(--text-neutral-default)',
  destructive: 'var(--background-danger-default)',
  border: 'var(--border-default)',
  input: 'var(--border-default)',
  ring: 'var(--border-brand-default)',
  // Picked from the util categorical ramp for distinctness (blue/green/yellow/orange/purple).
  'chart-1': 'var(--util-color-2)',
  'chart-2': 'var(--util-color-8)',
  'chart-3': 'var(--util-color-3)',
  'chart-4': 'var(--util-color-10)',
  'chart-5': 'var(--util-color-12)',
  sidebar: 'var(--background-main-default)',
  'sidebar-foreground': 'var(--text-neutral-default)',
  'sidebar-primary': 'var(--background-brand-default)',
  'sidebar-primary-foreground': 'var(--text-brand-on-brand)',
  'sidebar-accent': 'var(--background-main-secondary)',
  'sidebar-accent-foreground': 'var(--text-neutral-default)',
  'sidebar-border': 'var(--border-default)',
  'sidebar-ring': 'var(--border-brand-default)',
  // Garden extras consumed by product surfaces (bg-brand, text-warning, …).
  // --radius base var: still referenced bare by input-group/sonner/content-editor
  // (no fallback); 12px matches both the old 0.75rem and the new radius-lg.
  radius: '12px',
  brand: 'var(--background-brand-default)',
  'brand-foreground': 'var(--text-brand-on-brand)',
  success: 'var(--text-success-secondary)',
  warning: 'var(--text-warning-secondary)',
  info: 'var(--blue-500)',
  priority: 'var(--text-danger-secondary)',
}

// Legacy parchment-era vocabulary — TRANSITION ONLY, deleted at the end of the
// component sweep. Role-mapped to the nearest new semantic token.
const LEGACY_COMPAT = {
  parchment: 'var(--background-main-default)',
  'parchment-deep': 'var(--background-main-secondary)',
  vellum: 'var(--background-main-default)',
  'vellum-heavy': 'var(--background-main-default)',
  bone: 'var(--white-1000)',
  ink: 'var(--text-neutral-default)',
  gravel: 'var(--text-neutral-secondary)',
  slate: 'var(--text-neutral-tertiary)',
  stone: 'var(--text-tertiary)',
  hairline: 'var(--border-default)',
  'hairline-soft': 'var(--gray-200)',
  moss: 'var(--text-success-secondary)',
  sage: 'var(--text-success-tertiary)',
  amber: 'var(--text-warning-tertiary)',
  clay: 'var(--text-danger-tertiary)',
  lichen: 'var(--badge-green-background)',
  'lavender-mist': 'var(--badge-blue-background)',
  peach: 'var(--badge-yellow-background)',
  'dusk-rose': 'var(--badge-gray-background)',
}

// Legacy shadow names — kept separate from LEGACY_COMPAT colors so emission
// doesn't sniff value strings to decide whether to add a --color-* binding.
// `shadow-float-1` / `shadow-float-2` are real semantic tokens now (they flip
// in dark mode via the Dark set), so only the hairline aliases remain here.
const LEGACY_SHADOW_COMPAT = {
  'shadow-hairline': 'var(--shadow-1)',
  'shadow-hairline-soft': 'var(--shadow-2)',
}

// Tailwind namespace mapping for non-color primitives: token name → theme key.
const textSizeKey = (path) => path.replace(/^font-size-/, '--text-')
const trackingKey = (path) => path.replace(/^letter-spacing-/, '--tracking-')

// Tailwind pairs every --text-* with a --text-*--line-height; overriding only the
// size leaves the line-height var dangling. Pairings derive from the composite
// typography tokens: body styles (xs–lg) run 160%, headings (xl–3xl) 140%,
// display titles (4xl–6xl) 120%. caption's 1.2 stays on its own utility class.
const TEXT_LINE_HEIGHTS = {
  'font-size-xs': '160%',
  'font-size-sm': '160%',
  'font-size-base': '160%',
  'font-size-lg': '160%',
  'font-size-xl': '140%',
  'font-size-2xl': '140%',
  'font-size-3xl': '140%',
  'font-size-4xl': '120%',
  'font-size-5xl': '120%',
  'font-size-6xl': '120%',
}

/** Emits `:root` lines for one semantic set plus that mode's scrollbar tokens. */
function semanticLines(flat, mode) {
  const lines = flat.map((e) => varLine(e.path, resolveValue(e.token)))
  if (mode === 'light') {
    lines.push(varLine('scrollbar-thumb', 'var(--black-200)'))
    lines.push(varLine('scrollbar-thumb-hover', 'var(--black-300)'))
    lines.push(varLine('scrollbar-track', 'transparent'))
  } else {
    lines.push(varLine('scrollbar-thumb', 'var(--white-200)'))
    lines.push(varLine('scrollbar-thumb-hover', 'var(--white-300)'))
    lines.push(varLine('scrollbar-track', 'transparent'))
  }
  return lines
}

const out = []

out.push(
  `/* --------------------------------------------------------------------------`,
)
out.push(` * GENERATED FILE — do not edit by hand.`)
out.push(` * Source: packages/ui/tokens/tokens.json (Tokens Studio export)`)
out.push(` * Regenerate: pnpm --filter @garden/ui tokens:build`)
out.push(
  ` * ------------------------------------------------------------------------- */`,
)

// 1. :root — primitives + light semantics + compat
out.push(`\n:root {`)
out.push(`  /* Primitives — color scales */`)
for (const e of primitiveColors)
  out.push(varLine(e.path, resolveValue(e.token)))
out.push(`\n  /* Primitives — type atoms */`)
for (const e of fontSizes) out.push(varLine(e.path, resolveValue(e.token)))
for (const e of letterSpacings) out.push(varLine(e.path, resolveValue(e.token)))
out.push(`\n  /* Primitives — radii, shadows */`)
for (const e of radii) out.push(varLine(e.path, resolveValue(e.token)))
for (const e of shadows) out.push(varLine(e.path, resolveValue(e.token)))
out.push(
  `\n  /* Spec tokens — spacing / sizing / stroke (no Tailwind utilities; spec fidelity) */`,
)
for (const e of spacings) out.push(varLine(e.path, resolveValue(e.token)))
for (const e of sizings) out.push(varLine(e.path, resolveValue(e.token)))
for (const e of strokeWidths) out.push(varLine(e.path, resolveValue(e.token)))
out.push(`\n  /* Semantic tokens — Light mode */`)
out.push(...semanticLines(lightFlat, 'light'))
out.push(
  `\n  /* Compat — shadcn contract (references semantic vars; flips with dark mode) */`,
)
for (const [name, value] of Object.entries(SHADCN_COMPAT))
  out.push(varLine(name, value))
out.push(
  `\n  /* Compat — legacy garden vocabulary (TRANSITION ONLY — deleted after sweep) */`,
)
for (const [name, value] of Object.entries(LEGACY_COMPAT))
  out.push(varLine(name, value))
for (const [name, value] of Object.entries(LEGACY_SHADOW_COMPAT))
  out.push(varLine(name, value))
out.push(`}`)

// 2. :root.dark — dark semantics only
out.push(`\n:root.dark {`)
out.push(`  /* Semantic tokens — Dark mode */`)
out.push(...semanticLines(darkFlat, 'dark'))
out.push(`}`)

// 3. @theme inline — Tailwind utility bindings
out.push(`\n@theme inline {`)
out.push(`  /* Font stacks are owned app-side (apps/web/src/styles.css) */`)
out.push(`  --font-heading: var(--font-heading);`)
out.push(`  --font-sans: var(--font-sans);`)
out.push(`  --font-mono: var(--font-mono);`)
out.push(`  --font-prose: var(--font-prose);`)
out.push(`\n  /* Primitive colors */`)
for (const e of primitiveColors)
  out.push(varLine(`color-${e.path}`, `var(--${e.path})`))
out.push(`\n  /* Semantic colors */`)
for (const e of lightFlat) {
  if (e.token.$type !== 'color') continue
  out.push(varLine(`color-${e.path}`, `var(--${e.path})`))
}
out.push(`\n  /* Compat — shadcn + garden extras */`)
for (const name of Object.keys(SHADCN_COMPAT)) {
  // `radius` is a bare :root var (shadcn base), not a color utility namespace.
  if (name === 'radius') continue
  out.push(varLine(`color-${name}`, `var(--${name})`))
}
out.push(`\n  /* Compat — legacy (transition only) */`)
for (const name of Object.keys(LEGACY_COMPAT))
  out.push(varLine(`color-${name}`, `var(--${name})`))
for (const name of Object.keys(LEGACY_SHADOW_COMPAT))
  out.push(varLine(name, `var(--${name})`))
out.push(
  `\n  /* Type scale — token values override Tailwind defaults (line-heights paired per composite roles) */`,
)
for (const e of fontSizes) {
  out.push(varLine(textSizeKey(e.path).slice(2), `var(--${e.path})`))
  const lineHeight = TEXT_LINE_HEIGHTS[e.path]
  if (lineHeight)
    out.push(
      varLine(`${textSizeKey(e.path).slice(2)}--line-height`, lineHeight),
    )
}
for (const e of letterSpacings)
  out.push(varLine(trackingKey(e.path).slice(2), `var(--${e.path})`))
out.push(`\n  /* Radii — token values override Tailwind defaults */`)
for (const e of radii) out.push(varLine(e.path, `var(--${e.path})`))
out.push(`\n  /* Shadows */`)
for (const e of shadows) out.push(varLine(e.path, `var(--${e.path})`))
out.push(`\n  /* Semantic shadows (flip with the mode) */`)
for (const e of lightFlat) {
  if (e.token.$type === 'shadow')
    out.push(varLine(e.path, `var(--${e.path})`))
}
out.push(`}`)

// 4. Composite typography utilities
out.push('')
for (const e of typographies)
  out.push(typographyUtility(e.path, e.token.$value))

out.push('')

writeFileSync(outPath, out.join('\n'))
// Run the repo formatter on the output so the committed artifact is oxfmt-clean
// (oxfmt wraps long var()/shadow values — reimplementing its line-breaking in
// this generator would be needless coupling).
execFileSync(
  'pnpm',
  ['exec', 'oxfmt', '-c', join(repoRoot, '.oxfmtrc.json'), '--write', outPath],
  { cwd: repoRoot, stdio: 'inherit' },
)
console.log(
  `tokens.css written: ${globalFlat.length} global + ${lightFlat.length} light + ${darkFlat.length} dark tokens`,
)
