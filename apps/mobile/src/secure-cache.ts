/** SecureStore historically rejects values above roughly 2,048 bytes on iOS. */
const chunkCharacters = 384
const defaultMaxChunks = 64

interface SecureCacheStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

/** Publishes the manifest last so interrupted writes cannot expose mixed reads. */
export function createSecureReadCache(
  storage: SecureCacheStorage,
  prefix = 'garden.mobile.reads.v1',
  maxChunks = defaultMaxChunks,
) {
  async function clear() {
    await storage.remove(prefix)
    const removed = await Promise.allSettled(
      Array.from({ length: maxChunks }, (_, index) =>
        storage.remove(`${prefix}.${index}`),
      ),
    )
    if (removed.some((result) => result.status === 'rejected'))
      throw new Error('Saved read cleanup failed')
  }

  return {
    clear,
    read: async () => {
      const manifest = await storage.get(prefix)
      if (
        !manifest ||
        !/^[1-9][0-9]?$/.test(manifest) ||
        Number(manifest) > maxChunks
      )
        return null
      const chunks = await Promise.all(
        Array.from({ length: Number(manifest) }, (_, index) =>
          storage.get(`${prefix}.${index}`),
        ),
      )
      if (
        chunks.some(
          (chunk) =>
            chunk === null || Array.from(chunk).length > chunkCharacters,
        )
      )
        return null
      return chunks.join('')
    },
    write: async (value: string) => {
      const characters = Array.from(value)
      if (characters.length > maxChunks * chunkCharacters)
        throw new Error('Saved reads exceed the device limit')
      await clear()
      const chunks = Array.from(
        { length: Math.ceil(characters.length / chunkCharacters) },
        (_, index) =>
          characters
            .slice(index * chunkCharacters, (index + 1) * chunkCharacters)
            .join(''),
      )
      for (const [index, chunk] of chunks.entries())
        await storage.set(`${prefix}.${index}`, chunk)
      if (chunks.length) await storage.set(prefix, String(chunks.length))
    },
  }
}
