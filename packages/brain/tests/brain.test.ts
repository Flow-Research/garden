import { NodeFileSystem } from '@effect/platform-node'
import { DateTime, Effect, Layer } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { expect, layer } from '@effect/vitest'
import { Brain, RRF_K } from '../src/services/Brain.ts'
import { Kind, WorkspaceId } from '../src/domain/items.ts'
import type { NewBrainItem } from '../src/domain/items.ts'
import { BrainLive } from '../src/layers.ts'
import { withTestConfig } from './helpers.ts'

const workspaceId = WorkspaceId.make(`ws-brain-${crypto.randomUUID()}`)

const at = DateTime.makeUnsafe(new Date())

const note = (overrides: Partial<NewBrainItem> = {}): NewBrainItem => ({
  tenantId: workspaceId,
  kind: Kind.make('file'),
  label: 'hello',
  body: 'hello world',
  origin: { actor: { _tag: 'Human' as const, userId: 'test' }, at },
  ...overrides,
})

const BrainTestLive = Layer.merge(
  withTestConfig(BrainLive),
  NodeFileSystem.layer,
)
const skipHelixIntegration = process.env.GARDEN_ITEST_HELIX !== '1'

layer(BrainTestLive, { excludeTestServices: true })('brain', (it) => {
  it.effect.skipIf(skipHelixIntegration)('adds and reads a brain item', () =>
    Effect.gen(function* () {
      const brain = yield* Brain
      const added = yield* brain.addItem(note())
      expect(added.indexed).toBe(false)
      expect(added.label).toBe('hello')
      expect(added.tenantId).toBe(workspaceId)

      const loaded = yield* brain.read(added.id, workspaceId)
      expect(loaded?.body).toBe('hello world')
      expect(loaded?.kind).toBe(Kind.make('file'))
    }),
  )

  it.effect.skipIf(skipHelixIntegration)(
    'treats canonical duplicates as the same item',
    () =>
      Effect.gen(function* () {
        const brain = yield* Brain
        const first = yield* brain.addItem(
          note({ canonical: { type: 'file', value: 'shared.md' } }),
        )
        const second = yield* brain.addItem(
          note({ canonical: { type: 'file', value: 'shared.md' } }),
        )
        expect(second.id).toBe(first.id)
        expect(second.tenantId).toBe(first.tenantId)
      }),
  )

  it.effect.skipIf(skipHelixIntegration)(
    'rejects reads from a different tenant',
    () =>
      Effect.gen(function* () {
        const brain = yield* Brain
        const added = yield* brain.addItem(note())
        const other = yield* brain.read(added.id, WorkspaceId.make('ws-other'))
        expect(other).toBeNull()
      }),
  )

  it.effect.skipIf(skipHelixIntegration)(
    'addText items are searchable regardless of the free-text kind',
    () =>
      Effect.gen(function* () {
        const brain = yield* Brain
        yield* brain.ensureIndexes()
        const added = yield* brain.addText({
          tenantId: workspaceId,
          label: 'Solarpunk decision',
          body: 'the team agreed on unified brand messaging for the solarpunk line',
          kind: Kind.make('decision'),
          summary: 'brand decision',
          actor: {
            _tag: 'Agent' as const,
            agentId: 'test-agent',
            runId: 'test-run',
          },
        })
        expect(added.kind).toBe(Kind.make('decision'))
        expect(added.indexed).toBe(true)

        const hits = yield* brain.search({
          tenantId: workspaceId,
          query: 'solarpunk brand messaging',
          k: 5,
        })
        expect(hits.some((hit) => hit.item.id === added.id)).toBe(true)
        const hit = hits.find((h) => h.item.id === added.id)
        expect(hit?.item.kind).toBe(Kind.make('decision'))
        expect(hit?.score).toBeGreaterThan(0)
        expect(hit?.score).toBeLessThanOrEqual(6 * (1 / (RRF_K + 1)))
      }),
  )

  it.effect.skipIf(skipHelixIntegration)(
    'converges concurrent canonical text writes on one item',
    () =>
      Effect.gen(function* () {
        const brain = yield* Brain
        yield* brain.ensureIndexes()
        const input = {
          tenantId: workspaceId,
          label: 'Canonical write-back',
          body: 'Use D1 for durable workflow state.',
          kind: Kind.make('decision'),
          canonical: {
            type: 'brain-write-back-claim',
            value: `write-back-${crypto.randomUUID()}`,
          },
          actor: {
            _tag: 'Agent' as const,
            agentId: 'test-agent',
            runId: 'test-run',
          },
        }
        const [first, retry] = yield* Effect.all(
          [brain.addText(input), brain.addText(input)],
          { concurrency: 'unbounded' },
        )

        expect(retry.id).toBe(first.id)
      }),
  )

  it.effect.skipIf(skipHelixIntegration)(
    'invalidates changed content and removes stale sections on re-index',
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const brain = yield* Brain
          const fs = yield* FileSystem
          yield* brain.ensureIndexes()

          const path = yield* fs.makeTempFileScoped({
            prefix: 'garden-brain-reindex-',
            suffix: '.md',
          })
          yield* fs.writeFileString(
            path,
            [
              '## Alpha',
              'shared reindex marker alpha',
              '## Beta',
              'shared reindex marker beta',
              '## Gamma',
              'shared reindex marker gamma',
            ].join('\n'),
          )

          const item: NewBrainItem = {
            tenantId: workspaceId,
            kind: Kind.make('file'),
            label: 'reindex.md',
            canonical: { type: 'file', value: path },
            origin: {
              actor: { _tag: 'Human' as const, userId: 'test' },
              at,
            },
          }
          const added = yield* brain.addItem(item)
          const firstIndex = yield* brain.index(added.id, workspaceId)
          expect(firstIndex.indexed).toBe(true)
          expect(
            (yield* brain.sectionsOf(added.id, workspaceId))
              .map((section) => section.label)
              .sort(),
          ).toEqual(['Alpha', 'Beta', 'Gamma'])

          yield* fs.writeFileString(
            path,
            [
              '## Alpha',
              'shared reindex marker updated alpha',
              '## Beta',
              'shared reindex marker updated beta',
            ].join('\n'),
          )
          const updated = yield* brain.addItem({
            ...item,
            body: 'content changed before deferred indexing',
          })
          expect(updated.id).toBe(added.id)
          expect(updated.indexed).toBe(false)

          yield* brain.index(updated.id, workspaceId)
          const sections = yield* brain.sectionsOf(updated.id, workspaceId)
          expect(sections.map((section) => section.label).sort()).toEqual([
            'Alpha',
            'Beta',
          ])

          const hits = yield* brain.search({
            tenantId: workspaceId,
            query: 'shared reindex marker updated',
            k: 10,
          })
          expect(
            hits
              .filter((hit) => hit.item.kind === Kind.make('section'))
              .map((hit) => hit.item.label)
              .sort(),
          ).toEqual(['Alpha', 'Beta'])
        }),
      ),
  )

  it.effect.skipIf(skipHelixIntegration)(
    'keeps a user scoped note out of another viewer results',
    () =>
      Effect.gen(function* () {
        const brain = yield* Brain
        yield* brain.ensureIndexes()
        const owner = { teamIds: new Set<string>(), userId: 'owner-user' }
        const stranger = { teamIds: new Set<string>(), userId: 'other-user' }
        const added = yield* brain.addText({
          tenantId: workspaceId,
          label: 'Private note',
          body: 'the secret solarpunk roadmap stays with the owner',
          scope: { kind: 'user', userId: 'owner-user' },
          actor: { _tag: 'Agent' as const, agentId: 'agent', runId: 'run' },
        })
        expect(added.scope).toEqual({ kind: 'user', userId: 'owner-user' })

        const ownerHits = yield* brain.search({
          tenantId: workspaceId,
          query: 'secret solarpunk roadmap',
          k: 5,
          viewer: owner,
        })
        expect(ownerHits.some((hit) => hit.item.id === added.id)).toBe(true)

        const strangerHits = yield* brain.search({
          tenantId: workspaceId,
          query: 'secret solarpunk roadmap',
          k: 5,
          viewer: stranger,
        })
        expect(strangerHits.some((hit) => hit.item.id === added.id)).toBe(false)

        expect(yield* brain.read(added.id, workspaceId, stranger)).toBeNull()
        expect((yield* brain.read(added.id, workspaceId, owner))?.id).toBe(
          added.id,
        )
      }),
  )

  it.effect.skipIf(skipHelixIntegration)(
    'shows an org note to every viewer',
    () =>
      Effect.gen(function* () {
        const brain = yield* Brain
        yield* brain.ensureIndexes()
        const added = yield* brain.addText({
          tenantId: workspaceId,
          label: 'Shared note',
          body: 'the quixotic harbor manifest belongs to the whole org',
          actor: { _tag: 'Agent' as const, agentId: 'agent', runId: 'run' },
        })
        expect(added.scope).toEqual({ kind: 'org' })

        for (const userId of ['owner-user', 'other-user', undefined] as const) {
          const hits = yield* brain.search({
            tenantId: workspaceId,
            query: 'quixotic harbor manifest',
            k: 5,
            viewer: { teamIds: new Set<string>(), userId },
          })
          expect(hits.some((hit) => hit.item.id === added.id)).toBe(true)
        }
      }),
  )

  it.effect.skipIf(skipHelixIntegration)(
    'returns k visible notes when a higher-ranked invisible note matches',
    () =>
      Effect.gen(function* () {
        const brain = yield* Brain
        yield* brain.ensureIndexes()
        const token = `zephyrous-quokka-${crypto.randomUUID()}`
        const stranger = { teamIds: new Set<string>(), userId: 'other-user' }

        const hidden = yield* brain.addText({
          tenantId: workspaceId,
          label: 'Private protocol',
          body: `the ${token} protocol ${token} ${token} ${token} ${token}`,
          scope: { kind: 'user', userId: 'owner-user' },
          actor: { _tag: 'Agent' as const, agentId: 'agent', runId: 'run' },
        })
        for (let index = 0; index < 5; index += 1) {
          yield* brain.addText({
            tenantId: workspaceId,
            label: `Shared protocol ${index}`,
            body: `quarterly planning notes and travel receipts while mentioning the ${token} protocol once`,
            actor: { _tag: 'Agent' as const, agentId: 'agent', runId: 'run' },
          })
        }

        const strangerHits = yield* brain.search({
          tenantId: workspaceId,
          query: `the ${token} protocol`,
          k: 5,
          viewer: stranger,
        })

        expect(strangerHits).toHaveLength(5)
        expect(strangerHits.some((hit) => hit.item.id === hidden.id)).toBe(
          false,
        )
        expect(
          strangerHits.every((hit) => hit.item.scope?.kind !== 'user'),
        ).toBe(true)
      }),
  )
})
