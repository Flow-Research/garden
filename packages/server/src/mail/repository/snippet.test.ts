import { describe, expect, it } from 'vitest'
import { mailMessageSnippet } from './snippet.ts'

describe('mail message list snippets', () => {
  it('drops email document styles and returns only visible copy', () => {
    expect(
      mailMessageSnippet(
        null,
        `<html><head><style>
          .sm_px-0{@media (width>=40rem){padding-right:0!important}}
          @font-face { font-family: MailFont; src: url(https://tracker.test/font) }
        </style></head><body><p>You made a transfer of 89.55 USD.</p></body></html>`,
      ),
    ).toBe('You made a transfer of 89.55 USD.')
  })

  it('decodes entities and removes hidden preheader content', () => {
    expect(
      mailMessageSnippet(
        null,
        `<div style="display:none;max-height:0">tracking preheader</div>
         <main>Statement ready&nbsp;&amp; available</main>`,
      ),
    ).toBe('Statement ready & available')
  })

  it('normalizes safe plain-text previews', () => {
    expect(mailMessageSnippet('  Hello\n\nfrom Garden  ', null)).toBe(
      'Hello from Garden',
    )
  })

  it('removes literal markup and leading CSS from malformed text alternatives', () => {
    expect(
      mailMessageSnippet(
        `table { border-collapse: collapse !important; margin: 0 auto; }
         h1, h2, h3, p, a, span, td { color: #111; font-family: sans-serif; }
         <div>Welcome to Payoneer: Everything You Need to Get Started!</div>`,
        null,
      ),
    ).toBe('Welcome to Payoneer: Everything You Need to Get Started!')
  })
})
