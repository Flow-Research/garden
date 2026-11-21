import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { Result } from 'better-result'
import { ClientReadFailure } from '@garden/client'
import { createMobileController, type MobilePorts } from './controller'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((stop) => stop()))
})

/** Runs the real portable clients against HTTP while injecting the auth boundary. */
async function fixture() {
  let account = 'alice'
  let offline = false
  let membership = true
  let draft: string | null = null
  let cache: string | null = null
  let now = 1234
  let expiresAt = 100_000
  let expiryCallback: (() => void) | null = null
  let runReads = 0
  let requests = 0
  let threadHost = 'host'
  let dropChatAcknowledgement = false
  const createdChats: string[] = []
  let activeRunId = 'run'
  let originalStatus = 'running'
  const server = createServer((request, response) => {
    requests += 1
    const path = new URL(request.url ?? '/', 'http://fixture').pathname
    const workspace = request.headers['x-workspace-id']
    if (request.method === 'POST' && path === '/api/chat/threads') {
      let raw = ''
      request.on('data', (chunk) => {
        raw += String(chunk)
      })
      request.on('end', () => {
        const body = JSON.parse(raw)
        createdChats.push(body.id)
        if (dropChatAcknowledgement) {
          response.destroy()
          return
        }
        response.writeHead(201, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            id: body.id,
            workspaceId: workspace,
            title: 'New Chat',
            ownerUserId: 'alice',
            hostName: threadHost,
            runtime_kind: 'chat',
            runtime_key: body.id,
          }),
        )
      })
      return
    }
    if (request.method !== 'GET') {
      response.writeHead(405)
      response.end()
      return
    }
    const body =
      path === '/api/workspaces'
        ? membership
          ? [
              { id: 'a', name: 'Workspace A' },
              { id: 'b', name: 'Workspace B' },
            ]
          : []
        : path === '/api/issues'
          ? {
              issues: [
                {
                  id: 'task',
                  workspace_id: workspace,
                  title: 'Required work',
                  identifier: 'A-1',
                  status: 'todo',
                  updated_at: '2026-11-21T00:00:00Z',
                },
              ],
            }
          : path === '/api/chat/threads'
            ? [
                {
                  id: 'thread',
                  workspaceId: workspace,
                  title: 'Current conversation',
                  ownerUserId: 'alice',
                  hostName: threadHost,
                  runtime_kind: 'chat',
                  runtime_key: '10000000-0000-4000-8000-000000000001',
                },
                ...createdChats.map((id) => ({
                  id,
                  workspaceId: workspace,
                  title: 'New Chat',
                  ownerUserId: 'alice',
                  hostName: threadHost,
                  runtime_kind: 'chat',
                  runtime_key: id,
                })),
              ]
            : path === '/api/issues/task/active-run'
              ? {
                  run: {
                    id: activeRunId,
                    workspace_id: workspace,
                    issue_id: 'task',
                    status: 'running',
                    cancel_requested_at: null,
                    finished_at: null,
                    updated_at: 'now',
                  },
                }
              : path === '/api/issues/task/runs'
                ? [
                    {
                      id: 'run',
                      workspace_id: workspace,
                      issue_id: 'task',
                      status: originalStatus,
                      cancel_requested_at: null,
                      finished_at:
                        originalStatus === 'succeeded' ? 'later' : null,
                      updated_at: 'later',
                    },
                  ]
                : []
    if (path === '/api/issues/task/active-run') runReads += 1
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  )
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const ports: MobilePorts = {
    readCache: async () => cache,
    writeCache: async (value) => {
      cache = value
    },
    clearCache: async () => {
      cache = null
    },
    auth: () => ({
      sessionExpiresAt: () => expiresAt,
      createChatSocket: () => WebSocket,
      signIn: async () => Result.ok(account),
      session: async () =>
        offline
          ? Result.err(
              new ClientReadFailure({ code: 'transport', message: 'offline' }),
            )
          : Result.ok(account),
      signOut: async () => {},
      fetch: (input, init) => fetch(input, init),
    }),
    createRequestId: () => crypto.randomUUID(),
    now: () => now,
    scheduleExpiry: (callback) => {
      expiryCallback = callback
      return () => {
        expiryCallback = null
      }
    },
    readDraft: async () => draft,
    writeDraft: async (value) => {
      draft = value
    },
    clearDraft: async () => {
      draft = null
    },
  }
  const controller = createMobileController(ports)
  return {
    controller,
    origin,
    ports,
    draft: () => draft,
    cache: () => cache,
    expire: () => {
      expiryCallback?.()
    },
    setNow: (value: number) => {
      now = value
    },
    setExpiry: (value: number) => {
      expiresAt = value
    },
    createdChats: () => createdChats,
    dropChatAcknowledgement: () => {
      dropChatAcknowledgement = true
    },
    changeChatHost: () => {
      threadHost = 'changed-host'
    },
    runReads: () => runReads,
    requests: () => requests,
    completeAndReplaceRun: () => {
      activeRunId = 'new-run'
      originalStatus = 'succeeded'
    },
    setAccount: (value: string) => {
      account = value
    },
    setOffline: (value: boolean) => {
      offline = value
    },
    revoke: () => {
      membership = false
    },
  }
}

describe('native session controller', () => {
  it('reads real HTTP task/run/thread responses and the existing shared skills client', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    expect(app.controller.getSnapshot().phase).toBe('select-workspace')
    await app.controller.selectWorkspace('a')
    expect(app.controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      workspaceId: 'a',
      skillsCount: 0,
      syncedAt: 1234,
      threads: [{ id: 'thread', title: 'Current conversation' }],
    })
    await app.controller.selectTask('task')
    expect(app.controller.getSnapshot().run?.id).toBe('run')
    expect(app.runReads()).toBe(1)
  })

  it('keeps cached reads visibly stale while offline and refreshes authority on reconnect', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    app.setOffline(true)
    const before = app.requests()
    await app.controller.refresh()
    expect(app.controller.getSnapshot()).toMatchObject({
      phase: 'offline',
      syncedAt: 1234,
    })
    expect(app.controller.getSnapshot().tasks).toHaveLength(1)
    expect(app.requests()).toBe(before)
    app.setOffline(false)
    await app.controller.refresh()
    expect(app.controller.getSnapshot().phase).toBe('ready')
  })

  it('removes cached reads and private drafts after membership revocation', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    await app.controller.saveDraft('private')
    app.revoke()
    await app.controller.refresh()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(app.controller.getSnapshot()).toMatchObject({
      phase: 'blocked',
      tasks: [],
      threads: [],
      draft: '',
      accountId: null,
    })
    expect(app.draft()).toBeNull()
  })

  it('clears data when the server session changes account', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    await app.controller.saveDraft('private')
    app.setAccount('bob')
    await app.controller.refresh()
    expect(app.controller.getSnapshot()).toMatchObject({
      phase: 'blocked',
      tasks: [],
      draft: '',
      accountId: null,
    })
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    expect(app.controller.getSnapshot().draft).toBe('')
  })

  it('clears another workspace draft instead of displaying or replaying it', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    await app.controller.saveDraft('private A')
    await app.controller.selectWorkspace('b')
    expect(app.controller.getSnapshot()).toMatchObject({
      workspaceId: 'b',
      draft: '',
    })
    expect(app.draft()).toBeNull()
  })

  it('suspends client reads without sending a cancel or launch request', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    await app.controller.selectTask('task')
    const before = app.requests()
    app.controller.suspend()
    expect(app.controller.getSnapshot().phase).toBe('offline')
    expect(app.controller.getSnapshot().run?.id).toBe('run')
    expect(app.requests()).toBe(before)
    await app.controller.refresh()
    expect(app.controller.getSnapshot().phase).toBe('ready')
  })

  it('reconnects to the selected run instead of switching to a newer active run', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    await app.controller.selectTask('task')
    expect(app.controller.getSnapshot().selectedRunId).toBe('run')
    app.completeAndReplaceRun()
    app.controller.suspend()
    await app.controller.refresh()
    expect(app.controller.getSnapshot()).toMatchObject({
      selectedRunId: 'run',
      run: { id: 'run', status: 'succeeded' },
    })
    expect(app.runReads()).toBe(1)
  })

  it('serializes draft saves before logout erasure', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    let finish!: () => void
    const writeDraft = app.ports.writeDraft
    const started = new Promise<void>((resolve) => {
      app.ports.writeDraft = async (value) => {
        resolve()
        await new Promise<void>((done) => {
          finish = done
        })
        await writeDraft(value)
      }
    })
    const saving = app.controller.saveDraft('pending private')
    await started
    const logout = app.controller.signOut()
    expect(app.controller.getSnapshot()).toMatchObject({
      tasks: [],
      draft: '',
      accountId: null,
    })
    finish()
    await Promise.all([saving, logout])
    expect(app.draft()).toBeNull()
    expect(app.controller.getSnapshot().phase).toBe('signed-out')
  })

  it('refuses an unlisted workspace and clears private content on invalid reconnection input', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('unknown')
    expect(app.controller.getSnapshot().workspaceId).toBeNull()
    await app.controller.selectWorkspace('a')
    await app.controller.connect('https://attacker@example.com')
    expect(app.controller.getSnapshot()).toMatchObject({
      phase: 'blocked',
      accountId: null,
      tasks: [],
      draft: '',
    })
  })

  it('reports failed private cleanup and refuses reconnect until cleanup succeeds', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    await app.controller.saveDraft('private draft')
    const clearDraft = app.ports.clearDraft
    app.ports.clearDraft = () => Promise.reject(new Error('Device locked'))
    await app.controller.signOut()
    expect(app.controller.getSnapshot()).toMatchObject({
      phase: 'blocked',
      accountId: null,
      draft: '',
    })
    const requests = app.requests()
    await app.controller.connect(app.origin)
    expect(app.requests()).toBe(requests)
    expect(app.controller.getSnapshot().message).toContain(
      'Clear private sign-in data',
    )
    app.ports.clearDraft = clearDraft
    await app.controller.signOut()
    expect(app.controller.getSnapshot().phase).toBe('signed-out')
    expect(app.draft()).toBeNull()
  })

  it('restores only the current account and workspace draft after a new online session', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    await app.controller.saveDraft('Local draft after relaunch')
    const relaunched = createMobileController(app.ports)
    expect(relaunched.getSnapshot().draft).toBe('')
    await relaunched.connect(app.origin)
    await relaunched.selectWorkspace('a')
    expect(relaunched.getSnapshot().draft).toBe('Local draft after relaunch')
    app.setAccount('bob')
    await relaunched.connect(app.origin)
    await relaunched.selectWorkspace('a')
    expect(relaunched.getSnapshot().draft).toBe('')
    expect(app.draft()).toBeNull()
  })

  it('does not let a late sign-in replace a newer session', async () => {
    const app = await fixture()
    let finish!: (value: Result<string, ClientReadFailure>) => void
    const baseAuth = app.ports.auth(app.origin)
    app.ports.auth = () => ({
      ...baseAuth,
      signIn: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    })
    const stale = app.controller.connect(app.origin, {
      email: 'alice@example.test',
      password: 'fixture-only',
    })
    app.setAccount('bob')
    await app.controller.connect(app.origin)
    finish(Result.ok('alice'))
    await stale
    expect(app.controller.getSnapshot()).toMatchObject({
      accountId: 'bob',
      phase: 'select-workspace',
    })
  })

  it('erases an invalid persisted draft before another account can select a workspace', async () => {
    const app = await fixture()
    await app.ports.writeDraft('{invalid JSON')
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    expect(app.controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      draft: '',
    })
    expect(app.draft()).toBeNull()
  })

  it('restores a bounded identity-scoped snapshot and draft after offline cold start without HTTP', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    await app.controller.selectTask('task')
    await app.controller.saveDraft('Unsent private text')
    expect(app.cache()).not.toBeNull()
    app.setOffline(true)
    const before = app.requests()
    const relaunched = createMobileController(app.ports)
    await relaunched.openOffline(app.origin)
    expect(relaunched.getSnapshot()).toMatchObject({
      phase: 'offline',
      cacheStatus: 'stale',
      accountId: 'alice',
      workspaceId: 'a',
      run: { id: 'run' },
      selectedRunId: 'run',
      offlineExpiresAt: 100_000,
      draft: 'Unsent private text',
      syncedAt: 1234,
    })
    expect(relaunched.getSnapshot().tasks).toHaveLength(1)
    await relaunched.selectTask('task')
    expect(app.requests()).toBe(before)
    app.setOffline(false)
    await relaunched.refresh()
    expect(relaunched.getSnapshot().phase).toBe('ready')
  })

  it('hides and erases expired saved reads and drafts before an offline cold start', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    await app.controller.saveDraft('expired private draft')
    app.setNow(100_000)
    const relaunched = createMobileController(app.ports)
    await relaunched.openOffline(app.origin)
    expect(relaunched.getSnapshot()).toMatchObject({
      phase: 'blocked',
      cacheStatus: 'expired',
      accountId: null,
      tasks: [],
      draft: '',
    })
    expect(app.cache()).toBeNull()
    expect(app.draft()).toBeNull()
  })

  it('removes an open offline view when the saved server session expires', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    const relaunched = createMobileController(app.ports)
    await relaunched.openOffline(app.origin)
    app.setNow(100_000)
    app.expire()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(relaunched.getSnapshot()).toMatchObject({
      phase: 'blocked',
      cacheStatus: 'expired',
      accountId: null,
      tasks: [],
    })
    expect(app.cache()).toBeNull()
  })

  it('refuses corrupt, cross-origin and mixed-workspace persisted reads', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    const valid = app.cache() ?? 'null'
    const relaunched = createMobileController(app.ports)
    await relaunched.openOffline('https://other.example.test')
    expect(relaunched.getSnapshot().accountId).toBeNull()
    await app.ports.writeCache('{invalid')
    await relaunched.openOffline(app.origin)
    expect(relaunched.getSnapshot().tasks).toEqual([])
    const mixed = JSON.parse(valid)
    mixed.tasks[0].workspace_id = 'b'
    await app.ports.writeCache(JSON.stringify(mixed))
    await relaunched.openOffline(app.origin)
    expect(relaunched.getSnapshot().accountId).toBeNull()
    expect(relaunched.getSnapshot().message).toContain('No valid saved reads')
  })

  it('erases persistent snapshots on logout, workspace change and observed revocation', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    await app.controller.selectWorkspace('b')
    expect(JSON.parse(app.cache() ?? 'null').workspaceId).toBe('b')
    await app.controller.signOut()
    expect(app.cache()).toBeNull()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    app.revoke()
    await app.controller.refresh()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(app.cache()).toBeNull()
    const relaunched = createMobileController(app.ports)
    await relaunched.openOffline(app.origin)
    expect(relaunched.getSnapshot().accountId).toBeNull()
  })

  it('does not let a delayed persistent write restore private data after logout', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    let finish!: () => void
    const writeCache = app.ports.writeCache
    const started = new Promise<void>((resolve) => {
      app.ports.writeCache = async (value) => {
        resolve()
        await new Promise<void>((done) => {
          finish = done
        })
        await writeCache(value)
      }
    })
    const selecting = app.controller.selectWorkspace('a')
    await started
    const logout = app.controller.signOut()
    finish()
    await Promise.all([selecting, logout])
    expect(app.cache()).toBeNull()
    expect(app.controller.getSnapshot().accountId).toBeNull()
  })

  it('keeps online reads available but reports cache write failure', async () => {
    const app = await fixture()
    app.ports.writeCache = async () => {
      throw new Error('Device locked')
    }
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    expect(app.controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      cacheStatus: 'none',
    })
    expect(app.controller.getSnapshot().message).toContain('could not be saved')
  })

  it('blocks reconnect when persistent cache cleanup fails until an explicit retry succeeds', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    const clearCache = app.ports.clearCache
    app.ports.clearCache = async () => {
      throw new Error('Device locked')
    }
    await app.controller.signOut()
    expect(app.controller.getSnapshot().phase).toBe('blocked')
    const before = app.requests()
    await app.controller.connect(app.origin)
    expect(app.requests()).toBe(before)
    app.ports.clearCache = clearCache
    await app.controller.signOut()
    expect(app.cache()).toBeNull()
    expect(app.controller.getSnapshot().phase).toBe('signed-out')
  })

  it('refuses future timestamps and stops retaining oversized private snapshots', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    const raw = app.cache() ?? 'null'
    const snapshot = JSON.parse(raw)
    snapshot.syncedAt = 2000
    await app.ports.writeCache(JSON.stringify(snapshot))
    const relaunched = createMobileController(app.ports)
    await relaunched.openOffline(app.origin)
    expect(relaunched.getSnapshot().accountId).toBeNull()
    expect(app.cache()).toBeNull()
    snapshot.syncedAt = 1234
    snapshot.tasks[0].title = 'x'.repeat(24_576)
    await app.ports.writeCache(JSON.stringify(snapshot))
    await relaunched.openOffline(app.origin)
    expect(relaunched.getSnapshot().tasks).toEqual([])
  })

  it('resolves a real owned chat target and rechecks its identity before a turn', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    await app.controller.selectThread('thread')
    const target = app.controller.getSnapshot().selectedThread
    if (!target) throw new Error('Missing owned fixture target')
    expect((await app.controller.authorizeChat(target)).isOk()).toBe(true)
    app.changeChatHost()
    expect((await app.controller.authorizeChat(target)).isErr()).toBe(true)
    expect(app.controller.getSnapshot()).toMatchObject({
      phase: 'blocked',
      selectedThread: null,
      accountId: null,
    })
  })

  it('creates exactly one real HTTP chat despite simultaneous UI requests', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    await Promise.all([
      app.controller.createChat(),
      app.controller.createChat(),
    ])
    expect(app.createdChats()).toHaveLength(1)
    expect(app.controller.getSnapshot().selectedThread?.id).toBe(
      app.createdChats()[0],
    )
    expect(app.controller.getSnapshot().pendingChatId).toBeNull()
  })

  it('reconciles unknown creation acknowledgement by reads without repeating the POST', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    app.dropChatAcknowledgement()
    await app.controller.createChat()
    const pending = app.controller.getSnapshot().pendingChatId
    expect(pending).toBe(app.createdChats()[0])
    expect(app.controller.getSnapshot().message).toContain(
      'acknowledgement is unknown',
    )
    await app.controller.createChat()
    expect(app.createdChats()).toHaveLength(1)
    await app.controller.refresh()
    expect(app.controller.getSnapshot().pendingChatId).toBeNull()
    expect(app.createdChats()).toHaveLength(1)
    await app.controller.selectThread(pending ?? '')
    expect(app.controller.getSnapshot().selectedThread?.id).toBe(pending)
  })

  it('never creates or authorizes a chat from a restored offline snapshot', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    const relaunched = createMobileController(app.ports)
    await relaunched.openOffline(app.origin)
    const before = app.requests()
    await relaunched.createChat()
    await relaunched.selectThread('thread')
    expect(app.requests()).toBe(before)
    expect(app.createdChats()).toEqual([])
    expect(relaunched.getSnapshot().selectedThread).toBeNull()
  })

  it('restores a conversation-bound chat draft offline, permits local edits, and erases it on logout', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    await app.controller.selectThread('thread')
    await app.controller.saveChatDraft('thread', 'Private unsent conversation')
    await app.controller.saveChatDraft(
      'unrelated',
      'Must not replace this draft',
    )
    const relaunched = createMobileController(app.ports)
    const before = app.requests()
    await relaunched.openOffline(app.origin)
    expect(relaunched.getSnapshot().chatDraft).toEqual({
      threadId: 'thread',
      text: 'Private unsent conversation',
    })
    await relaunched.saveChatDraft('thread', 'Edited offline')
    expect(app.requests()).toBe(before)
    expect(JSON.parse(app.draft() ?? 'null').chatDraft.text).toBe(
      'Edited offline',
    )
    await relaunched.signOut()
    expect(app.draft()).toBeNull()
    expect(relaunched.getSnapshot().chatDraft).toBeNull()
  })

  it('does not let an old creation authority response clear a newer pending creation', async () => {
    const app = await fixture()
    const baseAuth = app.ports.auth(app.origin)
    let delay = false
    const waiting: ((value: Result<string, ClientReadFailure>) => void)[] = []
    app.ports.auth = () => ({
      ...baseAuth,
      session: () =>
        delay
          ? new Promise((resolve) => {
              waiting.push(resolve)
            })
          : baseAuth.session(),
    })
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    delay = true
    const oldCreation = app.controller.createChat()
    delay = false
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    delay = true
    const newCreation = app.controller.createChat()
    const pending = app.controller.getSnapshot().pendingChatId
    waiting[0]?.(Result.ok('alice'))
    await oldCreation
    expect(app.controller.getSnapshot().pendingChatId).toBe(pending)
    waiting[1]?.(Result.ok('alice'))
    await newCreation
    expect(app.createdChats()).toHaveLength(1)
  })

  it('keeps the original expiry when an offline user reselects the same workspace', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    await app.controller.saveDraft('Private data must expire')
    app.setOffline(true)
    const relaunched = createMobileController(app.ports)
    await relaunched.openOffline(app.origin)
    await relaunched.selectWorkspace('a')
    expect(relaunched.getSnapshot().offlineExpiresAt).toBe(100_000)
    app.setNow(100_000)
    app.expire()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(relaunched.getSnapshot()).toMatchObject({
      phase: 'blocked',
      accountId: null,
      draft: '',
      tasks: [],
    })
    expect(app.draft()).toBeNull()
    expect(app.cache()).toBeNull()
  })

  it('retains expiry when online workspace selection loses the connection', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    await app.controller.saveDraft('Must not outlive session')
    app.setOffline(true)
    await app.controller.selectWorkspace('a')
    app.setNow(100_000)
    app.expire()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(app.controller.getSnapshot()).toMatchObject({
      phase: 'blocked',
      accountId: null,
      draft: '',
    })
  })

  it('expires a ready private view and refuses an invalid server session expiry', async () => {
    const app = await fixture()
    await app.controller.connect(app.origin)
    await app.controller.selectWorkspace('a')
    app.setNow(100_000)
    app.expire()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(app.controller.getSnapshot().accountId).toBeNull()
    app.setNow(1234)
    app.setExpiry(Number.NaN)
    await app.controller.connect(app.origin)
    expect(app.controller.getSnapshot().accountId).toBeNull()
  })
})
