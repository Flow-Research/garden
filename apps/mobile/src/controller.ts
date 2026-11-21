import { Result } from 'better-result'
import {
  createGardenClient,
  parseGardenOrigin,
  ClientReadFailure,
  type RunPreview,
  type TaskPreview,
  type WorkspacePreview,
  type ChatThreadTarget,
} from '@garden/client'
import { createSkillsClient } from '@garden/client/skills'
import {
  decodeOfflineSnapshot,
  offlineCacheMaxCharacters,
} from '@garden/client/offline-cache'

export interface MobileAuth {
  signIn(
    email: string,
    password: string,
  ): Promise<Result<string, ClientReadFailure>>
  session(): Promise<Result<string, ClientReadFailure>>
  createChatSocket(path: string): typeof WebSocket
  sessionExpiresAt(): number | null
  signOut(): Promise<void>
  fetch: typeof globalThis.fetch
}

export interface MobilePorts {
  auth(origin: string): MobileAuth
  createRequestId(): string
  now(): number
  scheduleExpiry(callback: () => void, delayMs: number): () => void
  readCache(): Promise<string | null>
  writeCache(value: string): Promise<void>
  clearCache(): Promise<void>
  readDraft(): Promise<string | null>
  writeDraft(value: string): Promise<void>
  clearDraft(): Promise<void>
}

export interface MobileState {
  phase:
    | 'signed-out'
    | 'connecting'
    | 'select-workspace'
    | 'ready'
    | 'offline'
    | 'blocked'
  origin: string
  accountId: string | null
  workspaceId: string | null
  workspaces: WorkspacePreview[]
  tasks: TaskPreview[]
  threads: { id: string; title: string }[]
  run: RunPreview | null
  selectedTaskId: string | null
  selectedRunId: string | null
  skillsCount: number | null
  draft: string
  chatDraft: { threadId: string; text: string } | null
  selectedThread: ChatThreadTarget | null
  pendingChatId: string | null
  syncedAt: number | null
  offlineExpiresAt: number | null
  cacheStatus: 'none' | 'saved' | 'stale' | 'expired'
  message: string
}

/**
 * Keeps native lifecycle separate from host lifecycle. Scope changes discard
 * old reads and private data. An offline read never enables a consequential
 * action. This controller only reads existing managed Garden resources.
 */
export function createMobileController(ports: MobilePorts) {
  let state: MobileState = {
    phase: 'signed-out',
    origin: '',
    accountId: null,
    workspaceId: null,
    workspaces: [],
    tasks: [],
    threads: [],
    run: null,
    selectedTaskId: null,
    selectedRunId: null,
    skillsCount: null,
    draft: '',
    chatDraft: null,
    selectedThread: null,
    pendingChatId: null,
    syncedAt: null,
    offlineExpiresAt: null,
    cacheStatus: 'none',
    message: 'Sign in to Garden',
  }
  let generation = 0
  let chatSelection = 0
  let auth: MobileAuth | null = null
  let client: ReturnType<typeof createGardenClient> | null = null
  let skills: ReturnType<typeof createSkillsClient> | null = null
  const listeners = new Set<() => void>()
  let storageQueue = Promise.resolve()
  let cleanupRequired = false
  let cancelExpiry: (() => void) | null = null

  /** Erases both private stores on identity loss, after any earlier write. */
  async function clearPrivateData() {
    const outcomes = await Promise.allSettled([
      ports.clearDraft(),
      ports.clearCache(),
    ])
    if (outcomes.some((result) => result.status === 'rejected'))
      throw new Error('Private cleanup failed')
  }

  /** Keeps the saved scope only when the current online identity matches it. */
  async function discardForeignCache(
    accountId: string,
    origin: string,
    workspaceId?: string,
  ) {
    return draftStorage(async () => {
      const raw = await ports.readCache()
      if (!raw) return
      const parsed = decodeOfflineSnapshot(raw)
      if (
        parsed.isErr() ||
        parsed.value.accountId !== accountId ||
        parsed.value.origin !== origin ||
        (workspaceId && parsed.value.workspaceId !== workspaceId)
      )
        await ports.clearCache()
    })
  }

  /** Saves only complete, server-authorized reads within the device budget. */
  async function persistReads() {
    const expiresAt = auth?.sessionExpiresAt()
    if (
      state.phase !== 'ready' ||
      !state.accountId ||
      !state.workspaceId ||
      state.syncedAt === null ||
      !expiresAt ||
      expiresAt <= ports.now()
    )
      return
    const turn = generation
    const raw = JSON.stringify({
      version: 1,
      origin: state.origin,
      accountId: state.accountId,
      workspaceId: state.workspaceId,
      expiresAt,
      syncedAt: state.syncedAt,
      workspaces: state.workspaces,
      tasks: state.tasks,
      threads: state.threads,
      run: state.run,
      selectedTaskId: state.selectedTaskId,
      selectedRunId: state.selectedRunId,
      skillsCount: state.skillsCount,
    })
    const saved = await Result.tryPromise({
      try: () =>
        draftStorage(async () => {
          if (turn !== generation) return
          if (
            raw.length > offlineCacheMaxCharacters ||
            decodeOfflineSnapshot(raw).isErr()
          ) {
            await ports.clearCache()
            throw new Error('Snapshot exceeds the offline read budget')
          }
          await ports.writeCache(raw)
        }),
      catch: () =>
        new ClientReadFailure({
          code: 'response',
          message:
            'Offline reads could not be saved. Current online reads remain available.',
        }),
    })
    if (turn !== generation) return
    saved.match({
      ok: () => publish({ cacheStatus: 'saved', offlineExpiresAt: expiresAt }),
      err: (error) => publish({ cacheStatus: 'none', message: error.message }),
    })
  }

  /** Opens a device-protected snapshot without granting current authority. */
  async function openOffline(originValue: string) {
    if (cleanupRequired || state.accountId) return
    const parsed = parseGardenOrigin(originValue)
    if (parsed.isErr()) {
      publish({ phase: 'blocked', message: parsed.error.message })
      return
    }
    invalidate()
    const turn = generation
    const saved = await Result.tryPromise({
      try: () => draftStorage(() => ports.readCache()),
      catch: () =>
        new ClientReadFailure({
          code: 'response',
          message: 'Unlock this device to open saved reads',
        }),
    })
    if (turn !== generation) return
    if (saved.isErr()) {
      failed(saved.error, turn)
      return
    }
    const cached = saved.value ? decodeOfflineSnapshot(saved.value) : null
    if (!cached || cached.isErr() || cached.value.origin !== parsed.value) {
      publish({
        phase: 'blocked',
        message: 'No valid saved reads exist for this Garden server.',
      })
      return
    }
    const snapshot = cached.value
    if (snapshot.expiresAt <= ports.now() || snapshot.syncedAt > ports.now()) {
      cleanupRequired = true
      const cleared = await Result.tryPromise({
        try: () => draftStorage(clearPrivateData),
        catch: () => null,
      })
      if (turn !== generation) return
      cleanupRequired = cleared.isErr()
      publish({
        phase: 'blocked',
        cacheStatus: 'expired',
        message: cleared.isErr()
          ? 'Saved access expired. Private cleanup failed. Clear private sign-in data.'
          : 'Saved access expired. Connect online to sign in again.',
      })
      return
    }
    auth = ports.auth(snapshot.origin)
    publish({
      ...snapshot,
      phase: 'offline',
      offlineExpiresAt: snapshot.expiresAt,
      cacheStatus: 'stale',
      draft: '',
      chatDraft: null,
      message:
        'Saved private reads are stale. Access is unverified. Reconnect before any action.',
    })
    bindWorkspace(snapshot.workspaceId)
    await restoreDraft(turn)
  }

  /** Restores only the saved draft belonging to the displayed scope. */
  async function restoreDraft(turn: number) {
    const saved = await Result.tryPromise({
      try: () => draftStorage(() => ports.readDraft()),
      catch: () => null,
    })
    if (turn !== generation || saved.isErr() || !saved.value) return
    const rawDraft = saved.value
    const parsed = Result.try({
      try: () => JSON.parse(rawDraft) as unknown,
      catch: () => null,
    })
    if (parsed.isErr()) return
    const draft = parsed.value
    if (
      draft &&
      typeof draft === 'object' &&
      'origin' in draft &&
      draft.origin === state.origin &&
      'accountId' in draft &&
      draft.accountId === state.accountId &&
      'workspaceId' in draft &&
      draft.workspaceId === state.workspaceId &&
      'text' in draft &&
      typeof draft.text === 'string' &&
      draft.text.length <= 2000
    ) {
      const chatDraft = 'chatDraft' in draft ? draft.chatDraft : null
      publish({
        draft: draft.text,
        chatDraft:
          chatDraft &&
          typeof chatDraft === 'object' &&
          'threadId' in chatDraft &&
          typeof chatDraft.threadId === 'string' &&
          'text' in chatDraft &&
          typeof chatDraft.text === 'string' &&
          chatDraft.text.length <= 2000
            ? { threadId: chatDraft.threadId, text: chatDraft.text }
            : null,
      })
    }
  }

  /** Orders draft writes and erasure so a late save cannot undo logout cleanup. */
  function draftStorage<T>(operation: () => Promise<T>): Promise<T> {
    const next = storageQueue.then(operation)
    storageQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  /** Erases a persisted draft when account or workspace identity changes. */
  async function discardForeignDraft(
    accountId: string,
    origin: string,
    workspaceId?: string,
  ) {
    return draftStorage(async () => {
      const raw = await ports.readDraft()
      if (!raw) return
      const decoded = Result.try({
        try: () => JSON.parse(raw) as unknown,
        catch: () => null,
      })
      const value = decoded.isOk() ? decoded.value : null
      const matches =
        value &&
        typeof value === 'object' &&
        'accountId' in value &&
        value.accountId === accountId &&
        'origin' in value &&
        value.origin === origin &&
        (!workspaceId ||
          ('workspaceId' in value && value.workspaceId === workspaceId))
      if (!matches) await ports.clearDraft()
    })
  }

  /** Publishes an immutable snapshot for useSyncExternalStore on native/web. */
  function publish(update: Partial<MobileState>) {
    state = { ...state, ...update }
    cancelExpiry?.()
    cancelExpiry = null
    if (state.accountId !== null && state.offlineExpiresAt !== null) {
      cancelExpiry = ports.scheduleExpiry(
        () => {
          if (
            state.offlineExpiresAt !== null &&
            state.offlineExpiresAt <= ports.now()
          )
            loseAuthority(
              'Saved access expired. Connect online to sign in again.',
              'expired',
            )
          else publish({})
        },
        Math.min(
          2_147_483_647,
          Math.max(0, state.offlineExpiresAt - ports.now()),
        ),
      )
    }
    for (const listener of listeners) listener()
  }

  /** Ends old requests before publishing another account or workspace. */
  function invalidate() {
    generation += 1
    chatSelection += 1
    client?.invalidate()
    skills?.invalidate()
    client = null
    skills = null
  }

  /** A current refusal removes private content before another read can finish. */
  function loseAuthority(
    message = 'Sign in again. Workspace access changed.',
    cacheStatus: MobileState['cacheStatus'] = 'none',
  ) {
    invalidate()
    const turn = generation
    cleanupRequired = true
    publish({
      phase: 'blocked',
      accountId: null,
      workspaceId: null,
      workspaces: [],
      tasks: [],
      threads: [],
      run: null,
      selectedTaskId: null,
      selectedRunId: null,
      skillsCount: null,
      draft: '',
      chatDraft: null,
      selectedThread: null,
      pendingChatId: null,
      syncedAt: null,
      offlineExpiresAt: null,
      cacheStatus,
      message,
    })
    void Result.tryPromise({
      try: () => draftStorage(clearPrivateData),
      catch: () => null,
    }).then((result) => {
      if (turn !== generation) return
      result.match({
        ok: () => {
          cleanupRequired = false
        },
        err: () =>
          publish({
            message:
              'Private data cleanup failed. Unlock this device and clear private sign-in data.',
          }),
      })
    })
  }

  /** Session and workspace identity remain local inputs, never credentials. */
  function bindWorkspace(workspaceId: string | null) {
    const sessionId = ports.createRequestId()
    if (!auth || !state.accountId) return
    const options = {
      origin: state.origin,
      accountId: state.accountId,
      workspaceId,
      sessionId,
      fetch: auth.fetch,
      createRequestId: () => ports.createRequestId(),
    }
    client = createGardenClient({
      ...options,
      onAuthorityLost: loseAuthority,
    })
    skills = workspaceId
      ? createSkillsClient({
          ...options,
          workspaceId,
          onUnauthorized: loseAuthority,
        })
      : null
  }

  /** Handles failures without replacing a newer session or hiding stale data. */
  function failed(error: ClientReadFailure, expectedGeneration: number) {
    if (expectedGeneration !== generation) return
    if (error.code === 'transport') {
      if (state.accountId && state.offlineExpiresAt === null) {
        loseAuthority('Private access has no valid expiry. Sign in again.')
        return
      }
      publish({
        phase: 'offline',
        selectedThread: null,
        cacheStatus: state.syncedAt === null ? 'none' : 'stale',
        message: 'Offline. Cached reads are stale. Actions are unavailable.',
      })
    } else if (error.code === 'unauthorized' || error.code === 'forbidden') {
      loseAuthority()
    } else if (error.code !== 'session-ended') {
      publish({ phase: 'blocked', message: error.message })
    }
  }

  /** Uses the server's deadline for every private account view. */
  function sessionExpiry(candidate: MobileAuth) {
    const value = candidate.sessionExpiresAt()
    return value !== null && Number.isFinite(value) && value > ports.now()
      ? Result.ok(value)
      : Result.err(
          new ClientReadFailure({
            code: 'unauthorized',
            message: 'Sign-in expiry is missing or expired. Sign in again.',
          }),
        )
  }

  /** Establishes account identity online before exposing private persisted drafts. */
  async function connect(
    originValue: string,
    credentials?: { email: string; password: string },
  ) {
    if (cleanupRequired) {
      publish({
        phase: 'blocked',
        message: 'Clear private sign-in data before connecting again.',
      })
      return
    }
    invalidate()
    const turn = generation
    auth = null
    publish({
      phase: 'connecting',
      origin: '',
      accountId: null,
      workspaceId: null,
      workspaces: [],
      tasks: [],
      threads: [],
      run: null,
      selectedTaskId: null,
      selectedRunId: null,
      skillsCount: null,
      draft: '',
      chatDraft: null,
      selectedThread: null,
      pendingChatId: null,
      syncedAt: null,
      offlineExpiresAt: null,
      cacheStatus: 'none',
      message: 'Checking Garden sign-in',
    })
    const parsed = parseGardenOrigin(originValue)
    if (parsed.isErr()) {
      publish({ phase: 'blocked', message: parsed.error.message })
      return
    }
    publish({
      phase: 'connecting',
      origin: parsed.value,
      accountId: null,
      workspaceId: null,
      workspaces: [],
      tasks: [],
      threads: [],
      run: null,
      selectedTaskId: null,
      selectedRunId: null,
      skillsCount: null,
      draft: '',
      chatDraft: null,
      selectedThread: null,
      pendingChatId: null,
      syncedAt: null,
      offlineExpiresAt: null,
      cacheStatus: 'none',
      message: 'Checking Garden sign-in',
    })
    const candidate = ports.auth(parsed.value)
    auth = candidate
    const session = credentials
      ? await candidate.signIn(credentials.email, credentials.password)
      : await candidate.session()
    if (turn !== generation) return
    await session.match({
      ok: async (accountId) => {
        const expiry = sessionExpiry(candidate)
        if (expiry.isErr()) {
          failed(expiry.error, turn)
          return
        }
        const cleanup = await Result.tryPromise({
          try: async () => {
            await discardForeignDraft(accountId, parsed.value)
            await discardForeignCache(accountId, parsed.value)
          },
          catch: () =>
            new ClientReadFailure({
              code: 'response',
              message: 'Private draft cleanup failed',
            }),
        })
        if (turn !== generation) return
        if (cleanup.isErr()) {
          failed(cleanup.error, turn)
          return
        }
        auth = candidate
        publish({ accountId, offlineExpiresAt: expiry.value })
        bindWorkspace(null)
        const listing = await client?.listWorkspaces()
        if (turn !== generation || !listing) return
        listing.match({
          ok: (workspaces) =>
            publish({
              phase: 'select-workspace',
              workspaces,
              message: 'Select a workspace',
            }),
          err: (error) => failed(error, turn),
        })
      },
      err: async (error) => failed(error, turn),
    })
  }

  /** Reads from current membership; transport loss keeps only clearly stale reads. */
  async function refresh() {
    if (!state.workspaceId || !auth || !state.accountId) return
    invalidate()
    bindWorkspace(state.workspaceId)
    const current = client
    const currentSkills = skills
    const turn = generation
    if (!current || !currentSkills || !state.workspaceId || !auth) return
    const session = await auth.session()
    if (turn !== generation) return
    if (session.isErr()) {
      failed(session.error, turn)
      return
    }
    if (session.value !== state.accountId) {
      loseAuthority()
      return
    }
    const expiry = sessionExpiry(auth)
    if (expiry.isErr()) {
      failed(expiry.error, turn)
      return
    }
    const memberships = await current.listWorkspaces()
    if (turn !== generation) return
    if (memberships.isErr()) {
      failed(memberships.error, turn)
      return
    }
    if (
      !memberships.value.some((workspace) => workspace.id === state.workspaceId)
    ) {
      loseAuthority()
      return
    }
    const listing = await current.listTasks()
    if (turn !== generation) return
    listing.match({
      ok: ({ issues }) =>
        publish({
          phase: 'ready',
          offlineExpiresAt: expiry.value,
          tasks: issues,
          syncedAt: ports.now(),
          message: 'Tasks are current. No execution host is connected.',
        }),
      err: (error) => failed(error, turn),
    })
    if (listing.isErr()) return
    publish({ workspaces: memberships.value })
    if (
      state.selectedTaskId &&
      listing.value.issues.some((row) => row.id === state.selectedTaskId)
    )
      await selectTask(state.selectedTaskId, false)
    else publish({ selectedTaskId: null, selectedRunId: null, run: null })
    if (turn !== generation) return
    const threads = await current.listThreads()
    if (turn !== generation) return
    threads.match({
      ok: (rows) => publish({ threads: rows }),
      err: (error) => failed(error, turn),
    })
    if (threads.isErr()) return
    if (
      state.pendingChatId &&
      threads.value.some((row) => row.id === state.pendingChatId)
    )
      publish({ pendingChatId: null })
    const skillList = await Result.tryPromise({
      try: () => currentSkills.listSkills(),
      catch: () =>
        new ClientReadFailure({
          code: 'response',
          message: 'Skills read unavailable',
        }),
    })
    if (turn !== generation) return
    skillList.match({
      ok: (rows) => publish({ skillsCount: rows.length }),
      err: (error) => failed(error, turn),
    })
    if (skillList.isOk()) await persistReads()
  }

  /** Clears old scope immediately; only its matching encrypted draft is restored. */
  async function selectWorkspace(workspaceId: string) {
    const accountId = state.accountId
    const origin = state.origin
    if (
      (state.phase !== 'ready' && state.phase !== 'select-workspace') ||
      !state.workspaces.some((workspace) => workspace.id === workspaceId) ||
      !accountId
    )
      return
    invalidate()
    const turn = generation
    publish({
      workspaceId,
      tasks: [],
      threads: [],
      run: null,
      selectedTaskId: null,
      selectedRunId: null,
      skillsCount: null,
      draft: '',
      chatDraft: null,
      selectedThread: null,
      pendingChatId: null,
      syncedAt: null,
      cacheStatus: 'none',
    })
    bindWorkspace(workspaceId)
    const cleanup = await Result.tryPromise({
      try: async () => {
        await discardForeignDraft(accountId, origin, workspaceId)
        await discardForeignCache(accountId, origin, workspaceId)
      },
      catch: () =>
        new ClientReadFailure({
          code: 'response',
          message: 'Private draft cleanup failed',
        }),
    })
    if (turn !== generation) return
    if (cleanup.isErr()) {
      failed(cleanup.error, turn)
      return
    }
    await restoreDraft(turn)
    await refresh()
  }

  /** Rechecks current server identity and membership before any chat operation. */
  async function chatAuthority() {
    const current = client
    const candidate = auth
    const turn = generation
    const accountId = state.accountId
    const workspaceId = state.workspaceId
    if (
      state.phase !== 'ready' ||
      !candidate ||
      !current ||
      !accountId ||
      !workspaceId
    )
      return Result.err(
        new ClientReadFailure({
          code: 'session-ended',
          message: 'Reconnect and refresh access before using chat',
        }),
      )
    const result = await Result.gen(async function* () {
      const account = yield* Result.await(candidate.session())
      if (turn !== generation)
        return Result.err(
          new ClientReadFailure({
            code: 'session-ended',
            message: 'Chat scope changed',
          }),
        )
      const expiresAt = candidate.sessionExpiresAt()
      if (account !== accountId || !expiresAt || expiresAt <= ports.now())
        return Result.err(
          new ClientReadFailure({
            code: 'unauthorized',
            message: 'Chat sign-in changed or expired',
          }),
        )
      const memberships = yield* Result.await(current.listWorkspaces())
      if (turn !== generation)
        return Result.err(
          new ClientReadFailure({
            code: 'session-ended',
            message: 'Chat scope changed',
          }),
        )
      if (!memberships.some((row) => row.id === workspaceId))
        return Result.err(
          new ClientReadFailure({
            code: 'forbidden',
            message: 'Chat workspace access changed',
          }),
        )
      return Result.ok({ current, candidate, turn })
    })
    if (result.isErr()) failed(result.error, turn)
    return result
  }

  /** Resolves the owned chat facet from the existing server list. */
  async function selectThread(threadId: string) {
    const selection = ++chatSelection
    publish({ selectedThread: null })
    const authority = await chatAuthority()
    if (authority.isErr()) return
    const { current, turn } = authority.value
    const targets = await current.listChatTargets()
    if (turn !== generation || selection !== chatSelection) return
    targets.match({
      ok: (rows) => {
        const selectedThread = rows.find(
          (row) => row.id === threadId && row.runtime_kind === 'chat',
        )
        publish({
          selectedThread: selectedThread ?? null,
          message: selectedThread
            ? 'Connecting to the owned Garden chat'
            : 'This chat is unavailable. Issue-run chats remain in the web app.',
        })
      },
      err: (error) => failed(error, turn),
    })
  }

  /** Creates one chat without retrying an unknown server acknowledgement. */
  async function createChat() {
    if (state.phase !== 'ready' || state.pendingChatId) return
    const id = ports.createRequestId()
    const creationTurn = generation
    const selection = ++chatSelection
    publish({
      pendingChatId: id,
      message: 'Checking access to create a Garden chat',
    })
    const authority = await chatAuthority()
    if (authority.isErr()) {
      if (creationTurn === generation && state.pendingChatId === id)
        publish({ pendingChatId: null })
      return
    }
    const { current, turn } = authority.value
    const created = await current.createChatThread(id)
    if (turn !== generation) return
    created.match({
      ok: (thread) =>
        publish({
          pendingChatId: null,
          selectedThread:
            selection === chatSelection ? thread : state.selectedThread,
          threads: [thread, ...state.threads],
          message: 'Garden chat created',
        }),
      err: (error) => {
        if (error.code === 'transport' || error.code === 'response')
          publish({
            message:
              'Chat creation acknowledgement is unknown. Refresh the thread list before creating another chat.',
          })
        else failed(error, turn)
      },
    })
  }

  /** Checks the same owned runtime immediately before the SDK sends a turn. */
  async function authorizeChat(thread: ChatThreadTarget) {
    const authority = await chatAuthority()
    if (authority.isErr()) return Result.err(authority.error)
    const { current, turn } = authority.value
    const targets = await current.listChatTargets()
    if (turn !== generation)
      return Result.err(
        new ClientReadFailure({
          code: 'session-ended',
          message: 'Chat scope changed',
        }),
      )
    return targets
      .andThen((rows) => {
        const currentThread = rows.find((row) => row.id === thread.id)
        return currentThread &&
          currentThread.runtime_kind === 'chat' &&
          currentThread.hostName === thread.hostName &&
          currentThread.runtime_key === thread.runtime_key &&
          state.selectedThread?.id === thread.id &&
          state.selectedThread.hostName === thread.hostName &&
          state.selectedThread.runtime_key === thread.runtime_key
          ? Result.ok(undefined)
          : Result.err(
              new ClientReadFailure({
                code: 'forbidden',
                message: 'Chat identity or access changed. Reopen the chat.',
              }),
            )
      })
      .tapError((error) => failed(error, turn))
  }

  /** Saves notes without queueing an approval, launch, or cancellation. */
  async function saveDraft(text: string) {
    if (!state.accountId || !state.workspaceId || text.length > 2000) return
    publish({ draft: text })
    await persistDrafts()
  }

  /** Saves one chat draft under its conversation identity, including offline edits. */
  async function saveChatDraft(threadId: string, text: string) {
    if (
      !state.accountId ||
      !state.workspaceId ||
      text.length > 2000 ||
      (state.selectedThread?.id !== threadId &&
        state.chatDraft?.threadId !== threadId)
    )
      return
    publish({ chatDraft: { threadId, text } })
    await persistDrafts()
  }

  /** Skips superseded writes while retaining logout ordering. */
  async function persistDrafts() {
    const turn = generation
    const encode = () =>
      JSON.stringify({
        origin: state.origin,
        accountId: state.accountId,
        workspaceId: state.workspaceId,
        text: state.draft,
        chatDraft: state.chatDraft,
      })
    const draft = encode()
    const saved = await Result.tryPromise({
      try: () =>
        draftStorage(async () => {
          if (turn === generation && draft === encode())
            await ports.writeDraft(draft)
        }),
      catch: () =>
        new ClientReadFailure({
          code: 'response',
          message: 'Draft could not be saved on this device',
        }),
    })
    if (turn !== generation) return
    saved.tapError((error) => publish({ message: error.message }))
  }

  /** Displays one run without claiming that a cancel request proves termination. */
  async function selectTask(taskId: string, save = true) {
    const current = client
    const turn = generation
    if (
      state.phase !== 'ready' ||
      !current ||
      !state.tasks.some((task) => task.id === taskId)
    )
      return
    const expectedRunId =
      state.selectedTaskId === taskId ? state.selectedRunId : null
    publish({ selectedTaskId: taskId, selectedRunId: expectedRunId, run: null })
    if (expectedRunId) {
      const run = await current.getRun(taskId, expectedRunId)
      if (turn !== generation || state.selectedTaskId !== taskId) return
      run.match({
        ok: (row) => publish({ run: row }),
        err: (error) => failed(error, turn),
      })
      if (save && run.isOk()) await persistReads()
      return
    }
    const run = await current.getActiveRun(taskId)
    if (turn !== generation || state.selectedTaskId !== taskId) return
    run.match({
      ok: (page) =>
        publish({ run: page.run, selectedRunId: page.run?.id ?? null }),
      err: (error) => failed(error, turn),
    })
    if (save && run.isOk()) await persistReads()
  }

  /** Removes local private state even when remote sign-out cannot be reached. */
  async function signOut() {
    const currentAuth = auth
    invalidate()
    const turn = generation
    cleanupRequired = true
    publish({
      phase: 'blocked',
      accountId: null,
      workspaceId: null,
      workspaces: [],
      tasks: [],
      threads: [],
      run: null,
      selectedTaskId: null,
      selectedRunId: null,
      skillsCount: null,
      draft: '',
      chatDraft: null,
      selectedThread: null,
      pendingChatId: null,
      syncedAt: null,
      offlineExpiresAt: null,
      cacheStatus: 'none',
      message: 'Clearing private sign-in data',
    })
    const cleared = await Result.tryPromise({
      try: () => draftStorage(clearPrivateData),
      catch: () => null,
    })
    const credentials = currentAuth
      ? await Result.tryPromise({
          try: () => currentAuth.signOut(),
          catch: () => null,
        })
      : Result.ok(undefined)
    if (turn !== generation) return
    if (cleared.isErr() || credentials.isErr()) {
      publish({
        phase: 'blocked',
        message:
          'Sign-out cleanup failed. Unlock this device and clear private sign-in data again.',
      })
      return
    }
    auth = null
    cleanupRequired = false
    publish({ phase: 'signed-out', message: 'Signed out on this device' })
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    connect,
    openOffline,
    selectThread,
    createChat,
    authorizeChat,
    chatSocket: (path: string) => auth?.createChatSocket(path),
    selectWorkspace,
    refresh,
    selectTask,
    saveDraft,
    saveChatDraft,
    signOut,
    suspend: () => {
      if (!state.accountId || !state.workspaceId) return
      invalidate()
      bindWorkspace(state.workspaceId)
      publish({
        phase: 'offline',
        selectedThread: null,
        cacheStatus: state.syncedAt === null ? 'none' : 'stale',
        message: 'Connection paused. Reconnect to refresh authority.',
      })
    },
  }
}
