import { describe, expect, it } from 'vitest'
import { GardenApi } from './garden-api-contract'

describe('GardenApi', () => {
  it('keeps every Effect API group mounted in the shared API', () => {
    expect(Object.keys(GardenApi.groups).sort()).toEqual([
      'documentArtifacts',
      'executorTools',
      'skills',
    ])
  })
})
