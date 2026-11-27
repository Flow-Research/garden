import { NodeFileSystem } from '@effect/platform-node'
import { Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { Brain, makeBrain } from './services/Brain.ts'
import { LocalEmbeddingsLive } from './services/LocalEmbeddings.ts'
import { HelixClientLive } from './services/HelixClient.ts'
import { PageIndexLive } from './services/PageIndex.ts'
import { ExtractorLive } from './services/Extractor.ts'
import { ChunkerLive } from './services/Chunker.ts'
import { LocalRawFileStoreLive } from './services/RawFileStore.ts'
import { makeHelixClientLayer } from './services/HelixClient.ts'

export const BrainLive = Layer.effect(Brain, makeBrain).pipe(
  Layer.provide(HelixClientLive),
  Layer.provide(LocalEmbeddingsLive),
  Layer.provide(LocalRawFileStoreLive),
  Layer.provide(ChunkerLive),
  Layer.provide(ExtractorLive),
  Layer.provide(FetchHttpClient.layer),
)

export const ExtractorLiveLayer = ExtractorLive.pipe(
  Layer.provide(NodeFileSystem.layer),
)

export const PageIndexLiveLayer = PageIndexLive.pipe(
  Layer.provide(ChunkerLive),
  Layer.provide(ExtractorLiveLayer),
)

export const FullLive = Layer.mergeAll(
  BrainLive,
  PageIndexLiveLayer,
  ExtractorLiveLayer,
  ChunkerLive,
).pipe(Layer.provide(NodeFileSystem.layer))

export { makeHelixClientLayer }
