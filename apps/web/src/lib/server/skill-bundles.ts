import { Context, Effect, Layer } from 'effect'
import {
  SkillOperationError,
  SkillValidationError,
  type SkillFile,
  type SkillFileInput,
} from '@garden/core/skills'
import type * as schema from '@garden/db/schema'
import { AppRequest } from './effect-context'

const WORKSPACE_SKILL_R2_PREFIX = 'agent-skills/workspaces'

type SkillFileRow = typeof schema.skillFile.$inferSelect

export type StoredSkillBundleFile = {
  readonly id: string
  readonly skillId: string
  readonly path: string
  readonly contentHash: string
  readonly r2Key: string
}

export interface SkillBundlesService {
  readonly normalizeFiles: (
    files: ReadonlyArray<SkillFileInput> | undefined,
  ) => Effect.Effect<SkillFileInput[], SkillValidationError>
  readonly hash: (input: {
    readonly content: string
    readonly files: ReadonlyArray<SkillFileInput>
  }) => Effect.Effect<string, SkillOperationError>
  readonly storeFiles: (input: {
    readonly workspaceId: string
    readonly skillId: string
    readonly bundleHash: string
    readonly files: ReadonlyArray<SkillFileInput>
  }) => Effect.Effect<StoredSkillBundleFile[], SkillOperationError>
  readonly loadFiles: (
    rows: ReadonlyArray<SkillFileRow>,
  ) => Effect.Effect<SkillFile[], SkillOperationError>
  readonly deleteFiles: (
    rows: ReadonlyArray<SkillFileRow>,
  ) => Effect.Effect<void, SkillOperationError>
  readonly persistRuntime: (input: {
    readonly workspaceId: string
    readonly slug: string
    readonly content: string
    readonly files: ReadonlyArray<SkillFileInput>
  }) => Effect.Effect<void, SkillOperationError>
  readonly deleteRuntime: (input: {
    readonly workspaceId: string
    readonly slug: string
  }) => Effect.Effect<void, SkillOperationError>
}

export class SkillBundles extends Context.Service<
  SkillBundles,
  SkillBundlesService
>()('@garden/web/SkillBundles') {}

const storageError = (operation: string, cause: unknown) =>
  new SkillOperationError({
    operation,
    message: `Failed to ${operation}.`,
    cause,
  })

function normalizePath(path: string) {
  const normalized = path.trim().replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/')) return null
  if (normalized.split('/').some((segment) => segment === '..')) return null
  if (normalized.toLowerCase() === 'skill.md') return null
  return normalized
}

function contentType(path: string) {
  const lower = path.toLowerCase()
  if (lower.endsWith('.md')) return 'text/markdown; charset=utf-8'
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8'
  if (lower.endsWith('.sh')) return 'text/x-shellscript; charset=utf-8'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (/\.(?:c|css|go|html|jsx?|py|rs|sql|tsx?|txt|yaml|yml)$/.test(lower)) {
    return 'text/plain; charset=utf-8'
  }
  return 'application/octet-stream'
}

function workspaceRuntimePrefix(workspaceId: string, slug: string) {
  return `${WORKSPACE_SKILL_R2_PREFIX}/${workspaceId}/${slug}/`
}

function workspaceRuntimeKey(workspaceId: string, slug: string, path: string) {
  return `${workspaceRuntimePrefix(workspaceId, slug)}${path}`
}

function storedFileKey(input: {
  workspaceId: string
  skillId: string
  bundleHash: string
  path: string
}) {
  return [
    'skills',
    input.workspaceId,
    input.skillId,
    input.bundleHash,
    input.path,
  ].join('/')
}

function digest(value: string) {
  return Effect.tryPromise({
    try: async () => {
      const buffer = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(value),
      )
      return Array.from(new Uint8Array(buffer), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('')
    },
    catch: (cause) => storageError('hash skill bundle', cause),
  })
}

export const skillBundlesLayer = Layer.effect(
  SkillBundles,
  Effect.gen(function* () {
    const request = yield* AppRequest
    const bucket = request.env.FILES

    const normalizeFiles = Effect.fn('SkillBundles.normalizeFiles')(function* (
      files: ReadonlyArray<SkillFileInput> | undefined,
    ) {
      const normalized: SkillFileInput[] = []
      const paths = new Set<string>()
      for (const file of files ?? []) {
        const path = normalizePath(file.path)
        if (!path) {
          return yield* new SkillValidationError({
            operation: 'validate skill files',
            message: `Invalid skill file path: ${file.path}`,
          })
        }
        if (paths.has(path)) {
          return yield* new SkillValidationError({
            operation: 'validate skill files',
            message: `Duplicate skill file path: ${path}`,
          })
        }
        paths.add(path)
        normalized.push({ path, content: file.content })
      }
      return normalized
    })

    const hash = Effect.fn('SkillBundles.hash')(function* (input: {
      readonly content: string
      readonly files: ReadonlyArray<SkillFileInput>
    }) {
      const serialized = [
        input.content,
        ...[...input.files]
          .sort((left, right) => left.path.localeCompare(right.path))
          .map((file) => `${file.path}\n${file.content}`),
      ].join('\n---\n')
      return yield* digest(serialized)
    })

    const storeFiles = Effect.fn('SkillBundles.storeFiles')(function* (input: {
      readonly workspaceId: string
      readonly skillId: string
      readonly bundleHash: string
      readonly files: ReadonlyArray<SkillFileInput>
    }) {
      return yield* Effect.forEach(
        input.files,
        (file) =>
          Effect.gen(function* () {
            const contentHash = yield* digest(file.content)
            const r2Key = storedFileKey({ ...input, path: file.path })
            yield* Effect.tryPromise({
              try: () =>
                bucket.put(r2Key, file.content, {
                  httpMetadata: { contentType: contentType(file.path) },
                }),
              catch: (cause) => storageError('store skill file', cause),
            })
            return {
              id: crypto.randomUUID(),
              skillId: input.skillId,
              path: file.path,
              contentHash,
              r2Key,
            }
          }),
        { concurrency: 4 },
      )
    })

    const loadFiles = Effect.fn('SkillBundles.loadFiles')(function* (
      rows: ReadonlyArray<SkillFileRow>,
    ) {
      const now = new Date().toISOString()
      const loaded = yield* Effect.forEach(
        rows,
        (row) =>
          Effect.gen(function* () {
            if (!row.r2Key) return null
            const object = yield* Effect.tryPromise({
              try: () => bucket.get(row.r2Key as string),
              catch: (cause) => storageError('load skill file', cause),
            })
            if (!object) return null
            const content = yield* Effect.tryPromise({
              try: () => object.text(),
              catch: (cause) => storageError('read skill file', cause),
            })
            return {
              id: row.id,
              skill_id: row.skillId,
              path: row.path,
              content,
              content_hash: row.contentHash ?? null,
              r2_key: row.r2Key,
              created_at: now,
              updated_at: now,
            } satisfies SkillFile
          }),
        { concurrency: 4 },
      )
      const files: SkillFile[] = []
      for (const file of loaded) {
        if (file) files.push(file)
      }
      return files
    })

    const deleteFiles = Effect.fn('SkillBundles.deleteFiles')(function* (
      rows: ReadonlyArray<SkillFileRow>,
    ) {
      const keys = rows.flatMap((row) => (row.r2Key ? [row.r2Key] : []))
      if (keys.length === 0) return
      yield* Effect.tryPromise({
        try: () => bucket.delete(keys),
        catch: (cause) => storageError('delete skill files', cause),
      })
    })

    const deletePrefix = Effect.fn('SkillBundles.deletePrefix')(function* (
      prefix: string,
    ) {
      let cursor: string | undefined
      do {
        const listed = yield* Effect.tryPromise({
          try: () => bucket.list({ prefix, cursor }),
          catch: (cause) => storageError('list runtime skill files', cause),
        })
        const keys = listed.objects.map((object) => object.key)
        if (keys.length > 0) {
          yield* Effect.tryPromise({
            try: () => bucket.delete(keys),
            catch: (cause) => storageError('delete runtime skill files', cause),
          })
        }
        cursor = listed.truncated ? listed.cursor : undefined
      } while (cursor)
    })

    const persistRuntime = Effect.fn('SkillBundles.persistRuntime')(
      function* (input: {
        readonly workspaceId: string
        readonly slug: string
        readonly content: string
        readonly files: ReadonlyArray<SkillFileInput>
      }) {
        yield* deletePrefix(
          workspaceRuntimePrefix(input.workspaceId, input.slug),
        )
        const entries = [
          {
            path: 'SKILL.md',
            content: input.content,
            contentType: 'text/markdown; charset=utf-8',
          },
          ...input.files.map((file) => ({
            ...file,
            contentType: contentType(file.path),
          })),
        ]
        yield* Effect.forEach(
          entries,
          (entry) =>
            Effect.tryPromise({
              try: () =>
                bucket.put(
                  workspaceRuntimeKey(
                    input.workspaceId,
                    input.slug,
                    entry.path,
                  ),
                  entry.content,
                  { httpMetadata: { contentType: entry.contentType } },
                ),
              catch: (cause) => storageError('store runtime skill', cause),
            }),
          { concurrency: 4, discard: true },
        )
      },
    )

    const deleteRuntime = Effect.fn('SkillBundles.deleteRuntime')(
      function* (input: {
        readonly workspaceId: string
        readonly slug: string
      }) {
        yield* deletePrefix(
          workspaceRuntimePrefix(input.workspaceId, input.slug),
        )
      },
    )

    return SkillBundles.of({
      normalizeFiles,
      hash,
      storeFiles,
      loadFiles,
      deleteFiles,
      persistRuntime,
      deleteRuntime,
    })
  }),
)
