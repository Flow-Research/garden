import { Effect } from 'effect'
import { expect, layer } from '@effect/vitest'
import { Kind, WorkspaceId } from '../src/domain/items.ts'
import { FullLive } from '../src/layers.ts'
import { PageIndex } from '../src/services/PageIndex.ts'
import { Brain } from '../src/services/Brain.ts'
import { withTestConfig } from './helpers.ts'

const workspaceId = WorkspaceId.make(`ws-ingest-${crypto.randomUUID()}`)
const skipHelixIntegration = process.env.GARDEN_ITEST_HELIX !== '1'

layer(withTestConfig(FullLive), { excludeTestServices: true })(
  'ingest',
  (it) => {
    it.effect.skipIf(skipHelixIntegration)(
      'ingests pages idempotently and links sections to their note',
      () =>
        Effect.gen(function* () {
          const brain = yield* Brain
          const pageIndex = yield* PageIndex
          yield* brain.ensureIndexes()

          const pages = yield* pageIndex.load('fixtures/pages', workspaceId)

          const ingestAll = () =>
            Effect.gen(function* () {
              for (const page of pages) {
                const noteId = yield* brain.addItem(page.note)
                yield* brain.index(noteId.id, workspaceId)
              }
            })
          yield* ingestAll()

          const first = yield* Effect.forEach(pages, (page) =>
            brain.addItem(page.note),
          )
          yield* ingestAll()
          const second = yield* Effect.forEach(pages, (page) =>
            brain.addItem(page.note),
          )
          expect(second.map((item) => item.id)).toEqual(
            first.map((item) => item.id),
          )

          const helixDb = pages.find(
            (page) => page.note.label === 'HelixDB Basics',
          )
          if (helixDb === undefined) throw new Error('missing fixture')
          const noteId = yield* brain.addItem(helixDb.note)
          const sections = yield* brain.sectionsOf(noteId.id, workspaceId)
          expect(sections.map((section) => section.label).sort()).toEqual([
            'Nodes and edges',
            'Query model',
            'helixdb',
          ])

          const hybrid = yield* brain.search({
            tenantId: workspaceId,
            query: 'graph database',
            k: 10,
          })
          expect(hybrid[0]?.item.label).toBe('HelixDB Basics')
          const ids = hybrid.map((hit) => hit.item.id)
          expect(new Set(ids).size).toBe(ids.length)

          const hybridPasta = yield* brain.search({
            tenantId: workspaceId,
            query: 'how to cook and season food',
            k: 10,
          })
          expect(hybridPasta[0]?.item.label).toBe('Effects and Pasta')
        }),
    )

    it.effect.skipIf(skipHelixIntegration)(
      'extracts and indexes all supported document formats',
      () =>
        Effect.gen(function* () {
          const brain = yield* Brain
          const pageIndex = yield* PageIndex
          yield* brain.ensureIndexes()

          const pages = yield* pageIndex.load('fixtures/docs', workspaceId)

          const expected = [
            'fixtures/docs/helixdb.txt',
            'fixtures/docs/helixdb.pdf',
            'fixtures/docs/helixdb.docx',
            'fixtures/docs/helixdb.xlsx',
          ]
          expect(
            pages.map((page) => page.note.canonical?.value).sort(),
          ).toEqual(expected.sort())

          const txt = pages.find((page) =>
            page.note.canonical?.value.endsWith('.txt'),
          )
          const pdf = pages.find((page) =>
            page.note.canonical?.value.endsWith('.pdf'),
          )
          const docx = pages.find((page) =>
            page.note.canonical?.value.endsWith('.docx'),
          )
          const xlsx = pages.find((page) =>
            page.note.canonical?.value.endsWith('.xlsx'),
          )
          if (
            txt === undefined ||
            pdf === undefined ||
            docx === undefined ||
            xlsx === undefined
          ) {
            throw new Error('missing fixtures')
          }

          expect(txt.note.body).toContain('garden journal')
          expect(pdf.note.body).toContain('well drained soil')
          expect(docx.note.body?.toLowerCase()).toContain('compost bins')
          expect(xlsx.note.body).toContain('Contacts')
          expect(xlsx.note.body).toContain('sable')
          expect(xlsx.note.body).not.toContain('Hidden')

          for (const page of pages) {
            const noteId = yield* brain.addItem(page.note)
            yield* brain.index(noteId.id, workspaceId)
          }

          const xlsxNote = yield* brain.addItem(xlsx.note)
          const xlsxSections = yield* brain.sectionsOf(xlsxNote.id, workspaceId)
          expect(xlsxSections.map((section) => section.label)).toEqual([
            'Contacts',
          ])

          const hybrid = yield* brain.search({
            tenantId: workspaceId,
            query: 'compost bins',
            k: 10,
          })
          expect(hybrid.map((hit) => hit.item.label)).toContain('helixdb')

          const sectionHit = yield* brain.search({
            tenantId: workspaceId,
            query: 'manages helix',
            k: 10,
          })
          expect(
            sectionHit.some(
              (hit) =>
                hit.item.kind === Kind.make('section') &&
                hit.item.label === 'Contacts',
            ),
          ).toBe(true)

          const xlsxHybrid = yield* brain.search({
            tenantId: workspaceId,
            query: 'who manages the helix project',
            k: 10,
          })
          expect(
            xlsxHybrid.some(
              (hit) =>
                hit.item.kind === Kind.make('section') &&
                hit.item.label === 'Contacts',
            ),
          ).toBe(true)
        }),
    )
  },
)
