// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { parse } from '@executor-js/plugin-openapi/core'

describe('installed parser owners', () => {
  it('parses a YAML OpenAPI document through the actual Executor importer', async () => {
    const document = await Effect.runPromise(
      parse(`openapi: 3.0.3
info:
  title: Local parser fixture
  version: 1.0.0
paths:
  /items:
    get:
      responses:
        '200':
          description: Success
`),
    )
    expect(document.info.title).toBe('Local parser fixture')
    expect(document.paths?.['/items']?.get?.responses['200']).toMatchObject({
      description: 'Success',
    })
  })

  it('returns the importer error for an incomplete YAML document', async () => {
    await expect(Effect.runPromise(parse('openapi: [\n'))).rejects.toThrow()
  })
})
