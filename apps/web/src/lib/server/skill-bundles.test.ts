// @vitest-environment node

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { normalizeSkillFiles } from './skill-bundles'

describe('supporting skill file validation', () => {
  it('canonicalizes paths before they enter hashing and persistence', async () => {
    const files = await Effect.runPromise(
      normalizeSkillFiles([
        { path: ' ./references//./notes.md ', content: '# Notes' },
        { path: '.\\scripts\\.\\run.sh', content: 'echo hi' },
      ]),
    )
    expect(files).toEqual([
      { path: 'references/notes.md', content: '# Notes' },
      { path: 'scripts/run.sh', content: 'echo hi' },
    ])
  })

  it.each(['./notes.md', 'notes.md/', '.\\notes.md', '././notes.md'])(
    'rejects duplicate canonical path %s',
    async (alias) => {
      const error = await Effect.runPromise(
        Effect.flip(
          normalizeSkillFiles([
            { path: 'notes.md', content: 'original' },
            { path: alias, content: 'duplicate' },
          ]),
        ),
      )
      expect(error).toMatchObject({
        _tag: 'SkillValidationError',
        message: 'Duplicate skill file path: notes.md',
      })
    },
  )

  it('detects duplicates when both input paths need normalization', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        normalizeSkillFiles([
          { path: './references//notes.md', content: 'original' },
          { path: 'references/./notes.md', content: 'duplicate' },
        ]),
      ),
    )
    expect(error.message).toBe('Duplicate skill file path: references/notes.md')
  })

  it.each([
    'SKILL.md',
    './SKILL.md',
    './skill.md',
    '.\\SKILL.md',
    '././SKILL.md/',
    '',
    '.',
    './',
    './/./',
    '/notes.md',
    '\\notes.md',
    '../notes.md',
    'references/../notes.md',
    './references/../notes.md',
  ])(
    'rejects reserved, empty, absolute or traversing path %s',
    async (path) => {
      const error = await Effect.runPromise(
        Effect.flip(normalizeSkillFiles([{ path, content: '' }])),
      )
      expect(error).toMatchObject({
        _tag: 'SkillValidationError',
        message: `Invalid skill file path: ${path}`,
      })
    },
  )
})
