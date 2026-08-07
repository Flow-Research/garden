// @vitest-environment node

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { SkillDocuments, skillDocumentsLayer } from './skill-documents'

const run = <A, E>(effect: Effect.Effect<A, E, SkillDocuments>) =>
  Effect.runPromise(effect.pipe(Effect.provide(skillDocumentsLayer)))

describe('SkillDocuments', () => {
  it('decodes supported frontmatter and removes unsupported keys', async () => {
    const parsed = await run(
      Effect.gen(function* () {
        const documents = yield* SkillDocuments
        return yield* documents.parse(
          [
            '---',
            'name: Review',
            'description: Review code',
            'compatibility: garden',
            'unsupported: removed',
            '---',
            '# Review',
          ].join('\n'),
        )
      }),
    )

    expect(parsed.frontmatter).toEqual({
      name: 'Review',
      description: 'Review code',
      compatibility: 'garden',
    })
    expect(parsed.body).toBe('# Review')
  })

  it('builds and updates valid Agent Skills documents', async () => {
    const updated = await run(
      Effect.gen(function* () {
        const documents = yield* SkillDocuments
        const built = yield* documents.build({
          name: 'Review',
          description: 'Review code',
          body: '# Instructions',
        })
        return yield* documents.update({
          raw: built,
          description: 'Review TypeScript code',
          frontmatter: { compatibility: 'garden' },
        })
      }),
    )

    expect(updated).toContain('description: Review TypeScript code')
    expect(updated).toContain('compatibility: garden')
    expect(updated).toContain('# Instructions')
  })
})
