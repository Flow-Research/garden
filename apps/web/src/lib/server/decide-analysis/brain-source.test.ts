// @vitest-environment node
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { Brain, type BrainShape } from '@garden/brain/services/brain'
import { HelixError } from '@garden/brain/errors'
import { readBrainFileSource } from './brain-source'

type ReadFileItem = BrainShape['readFileItem']

const brainWith = (readFileItem: ReadFileItem) =>
  Layer.succeed(Brain, { readFileItem } as unknown as BrainShape)

const request = {
  workspaceId: 'workspace_1',
  ownerUserId: 'user_1',
  source: { kind: 'brain_file' as const, fileId: 'file_1' },
}

describe('readBrainFileSource', () => {
  it('returns the full extracted text of a file the owner can see', async () => {
    const seen: unknown[] = []
    const read = readBrainFileSource(
      brainWith((id, tenantId, viewer) => {
        seen.push({ id, tenantId, userId: viewer?.userId })
        return Effect.succeed({ body: 'region\trevenue\nNorth\t120' } as never)
      }),
    )

    const text = await read(request)

    expect(text.unwrap()).toBe('region\trevenue\nNorth\t120')
    expect(seen).toEqual([
      { id: 'file_1', tenantId: 'workspace_1', userId: 'user_1' },
    ])
  })

  it('reports a missing or hidden file as unavailable', async () => {
    const read = readBrainFileSource(brainWith(() => Effect.succeed(null)))

    const text = await read(request)

    expect(text.isErr() && text.error.code).toBe('source_unavailable')
  })

  it('reports a file without extracted text', async () => {
    const read = readBrainFileSource(
      brainWith(() => Effect.succeed({ body: undefined } as never)),
    )

    const text = await read(request)

    expect(text.isErr() && text.error.message).toMatch(/no extracted text/)
  })

  it('reports a Brain failure as unavailable instead of throwing', async () => {
    const read = readBrainFileSource(
      brainWith(() =>
        Effect.fail(new HelixError({ message: 'down' } as never)),
      ),
    )

    const text = await read(request)

    expect(text.isErr() && text.error.code).toBe('source_unavailable')
  })
})
