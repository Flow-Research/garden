import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  applyOperation,
  setDocument,
  type WorkspaceDocsDocument,
  type WorkspaceDocsOperation,
  type WorkspaceDocsOperationResult,
  type WorkspaceDocsSetDocument,
} from '../../../../third_party/cloudflare-os/workspace-docs/server-authority'

interface UpstreamStorage {
  readonly get: (key: string) => Promise<unknown>
  readonly put: (key: string, value: unknown) => Promise<void>
}

interface UpstreamGadget {
  broadcast: (event: unknown) => Promise<void>
  readonly applyOperation: (
    operation: WorkspaceDocsOperation,
  ) => Promise<WorkspaceDocsOperationResult>
  readonly setDocument: (
    args: WorkspaceDocsSetDocument,
  ) => Promise<WorkspaceDocsDocument>
}

type UpstreamGadgetConstructor = new (
  ctx: { storage: UpstreamStorage },
  env: Record<string, never>,
) => UpstreamGadget

/**
 * Evaluates the exact vendored server after removing only its module syntax.
 * The fake DurableObject supplies the same `ctx`/`env` fields used upstream.
 */
function loadUpstreamGadget(now: number): UpstreamGadgetConstructor {
  const source = readFileSync(
    new URL(
      '../../../../third_party/cloudflare-os/workspace-docs/server.js',
      import.meta.url,
    ),
    'utf8',
  )
  const executable = source
    .replace('import { DurableObject } from "cloudflare:workers";', '')
    .replace('export class Gadget', 'class Gadget')

  class FakeDurableObject {
    readonly ctx: { storage: UpstreamStorage }
    readonly env: Record<string, never>

    constructor(ctx: { storage: UpstreamStorage }, env: Record<string, never>) {
      this.ctx = ctx
      this.env = env
    }
  }

  return runInNewContext(`${executable}\nGadget`, {
    Date: { now: () => now },
    DurableObject: FakeDurableObject,
    queueMicrotask,
  }) as UpstreamGadgetConstructor
}

/** Creates one isolated exact-upstream authority with observable storage/events. */
function makeUpstreamAuthority(now: number, initial?: WorkspaceDocsDocument) {
  const values = new Map<string, unknown>()
  if (initial) values.set('document:v2', initial)
  const events: unknown[] = []
  const storage: UpstreamStorage = {
    get: async (key) => values.get(key),
    put: async (key, value) => {
      values.set(key, value)
    },
  }
  const Gadget = loadUpstreamGadget(now)
  const gadget = new Gadget({ storage }, {})
  gadget.broadcast = async (event) => {
    events.push(event)
  }
  return { events, gadget, values }
}

const initial: WorkspaceDocsDocument = {
  revision: 3,
  title: 'Plan',
  blocks: [
    { id: 'intro', html: '<p>Introduction</p>', version: 2 },
    { id: 'body', html: '<p>Draft</p>', version: 4 },
  ],
  lastModified: 100,
}

describe('Cloudflare OS Workspace Docs server authority adaptation', () => {
  it('matches exact setDocument replacement and stable-id versioning', async () => {
    const now = 200
    const args: WorkspaceDocsSetDocument = {
      title: 'Published',
      blocks: [
        { id: 'body', html: '<p>Ready</p>' },
        { id: 'new', html: '<p>New</p>' },
        { id: 'new', html: '<p>Dropped duplicate</p>' },
      ],
    }
    const upstream = makeUpstreamAuthority(now, initial)

    const actual = await upstream.gadget.setDocument(args)
    const adapted = setDocument(initial, args, now)

    expect(structuredClone(actual)).toEqual(adapted)
    expect(structuredClone(upstream.values.get('document:v2'))).toEqual(adapted)
    expect(structuredClone(upstream.events)).toEqual([
      { type: 'snapshot', senderId: undefined, document: adapted },
    ])
  })

  it('matches exact applyOperation results and committed documents', async () => {
    const cases: ReadonlyArray<{
      readonly name: string
      readonly operation: WorkspaceDocsOperation
    }> = [
      {
        name: 'partial conflict',
        operation: {
          senderId: 'client-a',
          upserts: [
            { id: 'intro', html: '<p>Stale</p>', baseVersion: 1 },
            { id: 'body', html: '<p>Ready</p>', baseVersion: 4 },
          ],
          deletes: [],
          order: ['body', 'intro'],
        },
      },
      {
        name: 'pure conflict',
        operation: {
          senderId: 'client-b',
          upserts: [{ id: 'intro', html: '<p>Stale</p>', baseVersion: 1 }],
          deletes: [],
          order: ['intro', 'body'],
        },
      },
      {
        name: 'missing nonzero version',
        operation: {
          senderId: 'client-c',
          upserts: [{ id: 'missing', html: '<p>Skipped</p>', baseVersion: 7 }],
          deletes: [],
          order: ['intro', 'body'],
        },
      },
      {
        name: 'delete, blank title, and last-writer order',
        operation: {
          senderId: 'client-d',
          upserts: [{ id: 'new', html: '<p>New</p>', baseVersion: 0 }],
          deletes: [{ id: 'intro', baseVersion: 2 }],
          order: ['new', 'body', 'new'],
          title: '',
        },
      },
    ]

    for (const testCase of cases) {
      const now = 201
      const upstream = makeUpstreamAuthority(now, initial)
      const actual = await upstream.gadget.applyOperation(testCase.operation)
      const adapted = applyOperation(initial, testCase.operation, now)

      expect(structuredClone(actual), testCase.name).toEqual(adapted.result)
      expect(
        structuredClone(upstream.values.get('document:v2')),
        testCase.name,
      ).toEqual(adapted.document)
      expect(upstream.events.length, testCase.name).toBe(
        'type' in adapted.result ? 1 : 0,
      )
      if ('type' in adapted.result) {
        expect(structuredClone(upstream.events), testCase.name).toEqual([
          {
            type: adapted.result.type,
            senderId: adapted.result.senderId,
            revision: adapted.result.revision,
            title: adapted.result.title,
            upserts: adapted.result.upserts,
            deletedIds: adapted.result.deletedIds,
            order: adapted.result.order,
            lastModified: adapted.result.lastModified,
          },
        ])
      }
    }
  })
})
