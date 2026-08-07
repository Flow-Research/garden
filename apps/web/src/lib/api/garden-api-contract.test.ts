import { describe, expect, it } from 'vitest'
import { GardenApi } from './garden-api-contract'

describe('GardenApi', () => {
  it('keeps skills and document artifacts mounted in the shared API', () => {
    expect(Object.keys(GardenApi.groups).sort()).toEqual([
      'documentArtifacts',
      'skills',
    ])
  })
})
