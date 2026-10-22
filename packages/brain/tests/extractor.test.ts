import { NodeFileSystem } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { expect, layer } from '@effect/vitest'
import { ExtractorLive } from '../src/services/Extractor.ts'
import {
  Extractor,
  FileFormat,
  formatOf,
} from '../src/services/ExtractorService.ts'

/** Verifies that CSV uploads keep their raw text while using a distinct file
 * format so the Brain ingestion path can accept and index them. */
layer(Layer.provide(ExtractorLive, NodeFileSystem.layer))('extractor', (it) => {
  it.effect('extracts CSV bytes as text with CSV format metadata', () =>
    Effect.gen(function* () {
      const extractor = yield* Extractor
      const csv = 'region,revenue\nNorth,15300\nSouth,12900\n'
      const doc = yield* extractor.extractFromBytes(
        'sales.csv',
        new TextEncoder().encode(csv),
      )

      expect(formatOf('sales.csv')).toBe(FileFormat.Csv)
      expect(doc.format).toBe(FileFormat.Csv)
      expect(doc.body).toBe(csv)
    }),
  )
})
