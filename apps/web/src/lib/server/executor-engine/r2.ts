// Adapted from Executor v1.5.40 packages/hosts/cloudflare/src/blob-store.ts
// (MIT). The upstream package is private; BlobStore is public SDK API.
import { Effect } from 'effect'
import { StorageError, type BlobStore } from '@executor-js/sdk/core'

const objectName = (namespace: string, key: string): string =>
  `${namespace}/${key}`

const storeError = (operation: string) => (cause: unknown) =>
  new StorageError({ message: `R2 blob ${operation} failed`, cause })

/** Supplies Executor's plugin-blob seam without routing large values through D1. */
export const makeR2BlobStore = (bucket: R2Bucket): BlobStore => ({
  get: (namespace, key) =>
    Effect.tryPromise({
      try: async () => {
        const object = await bucket.get(objectName(namespace, key))
        return object === null ? null : await object.text()
      },
      catch: storeError('get'),
    }),
  getMany: (namespaces, key) =>
    Effect.tryPromise({
      try: async () => {
        const hits = new Map<string, string>()
        await Promise.all(
          namespaces.map(async (namespace) => {
            const object = await bucket.get(objectName(namespace, key))
            if (object !== null) hits.set(namespace, await object.text())
          }),
        )
        return hits
      },
      catch: storeError('getMany'),
    }),
  put: (namespace, key, value) =>
    Effect.tryPromise({
      try: async () => {
        await bucket.put(objectName(namespace, key), value)
      },
      catch: storeError('put'),
    }),
  delete: (namespace, key) =>
    Effect.tryPromise({
      try: () => bucket.delete(objectName(namespace, key)),
      catch: storeError('delete'),
    }),
  has: (namespace, key) =>
    Effect.tryPromise({
      try: async () => (await bucket.head(objectName(namespace, key))) !== null,
      catch: storeError('has'),
    }),
})
