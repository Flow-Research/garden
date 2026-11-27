// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ALL_STATUSES,
  STATUS_CONFIG,
  STATUS_PILL_TEXT,
} from '@garden/core/issues/config'

const tokens = readFileSync(
  fileURLToPath(
    new URL('../../../../packages/ui/styles/tokens.css', import.meta.url),
  ),
  'utf8',
)

/** Every value a token takes, across the light and dark theme blocks. */
function tokenValues(name: string): string[] {
  return [...tokens.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'gi'))]
    .map((match) => match[1] ?? '')
    .filter(Boolean)
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

const tone = (className: string) =>
  className.match(/(?:text|bg)-([a-z-]+?)(?:\/\d+)?$/)?.[1]

describe('issue status colours', () => {
  it('uses one tone per status for the icon and hover', () => {
    for (const status of ALL_STATUSES) {
      const config = STATUS_CONFIG[status]
      if (config.hoverBg === 'hover:bg-accent') continue
      expect(tone(config.hoverBg), status).toBe(tone(config.iconColor))
    }
  })

  it('keeps pill text readable on every pill fill, in both themes', () => {
    const text = tokenValues(STATUS_PILL_TEXT.replace('text-', ''))
    expect(text.length).toBeGreaterThan(0)
    for (const status of ALL_STATUSES) {
      const fillToken =
        STATUS_CONFIG[status].pillFill.match(/var\(--(.+)\)/)?.[1]
      const fills = tokenValues(fillToken ?? '')
      expect(fills.length, status).toBeGreaterThan(0)
      for (const fill of fills) {
        for (const color of text) {
          expect(contrast(fill, color), status).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })
})
