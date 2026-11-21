import { createAuthClient } from 'better-auth/react'
import { expoClient, storageAdapter } from '@better-auth/expo/client'
import * as SecureStore from 'expo-secure-store'
import * as Crypto from 'expo-crypto'
import { Result } from 'better-result'
import { ClientReadFailure } from '@garden/client'
import type { MobileAuth, MobilePorts } from './controller'
import { createNativeFetch } from './transport'
import { createSecureReadCache } from './secure-cache'
import { createNativeChatSocket } from './native-chat-socket'

const draftKey = 'garden.mobile.draft.v1'
const secureOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
}
const secureStorage = {
  getItem: (key: string) => SecureStore.getItem(key, secureOptions),
  getItemAsync: (key: string) => SecureStore.getItemAsync(key, secureOptions),
  setItem: (key: string, value: string) =>
    SecureStore.setItem(key, value, secureOptions),
  setItemAsync: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value, secureOptions),
}
const authByOrigin = new Map<string, MobileAuth>()

/**
 * The official Expo plugin owns cookies in SecureStore. Each origin has a
 * separate prefix so switching servers cannot send an old server's credential.
 * References: Better Auth Expo integration and GHSA-4wq4-2ppv-q3hg.
 */
function nativeAuth(origin: string): MobileAuth {
  const existing = authByOrigin.get(origin)
  if (existing) return existing
  const prefix = `garden.${Array.from(origin)
    .map((char) => char.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('')}`
  const storage = storageAdapter(secureStorage)
  const client = createAuthClient({
    baseURL: origin,
    // Password-only native auth uses the existing endpoints. Do not enable
    // the unpatched Expo server proxy on Garden's current Better Auth version.
    fetchOptions: {
      customFetchImpl: createNativeFetch(origin, globalThis.fetch),
    },
    plugins: [
      expoClient({
        scheme: 'garden-mobile',
        storage: secureStorage,
        storagePrefix: prefix,
        disableCache: true,
      }),
    ],
  })
  let authQueue = Promise.resolve()
  let expiresAt: number | null = null
  let chatCookie = ''

  /** Finishes an old sign-in before logout erases its stored credential. */
  function ordered<T>(operation: () => Promise<T>): Promise<T> {
    const next = authQueue.then(operation)
    authQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  /** Converts fresh server session outcomes into the controller's account ID. */
  async function readSession() {
    const response = await Result.tryPromise({
      try: () => client.getSession({ query: { disableCookieCache: true } }),
      catch: () =>
        new ClientReadFailure({
          code: 'transport',
          message: 'Garden could not be reached',
        }),
    })
    const cookies = await Result.tryPromise({
      try: () => client.getCookie(),
      catch: () =>
        new ClientReadFailure({
          code: 'response',
          message: 'Unlock this device to read sign-in credentials',
        }),
    })
    if (cookies.isErr()) return cookies
    chatCookie = cookies.value
    return response.andThen((page) => {
      if (page.error)
        return Result.err(
          new ClientReadFailure({
            code:
              page.error.status === 401 || page.error.status === 403
                ? 'unauthorized'
                : 'transport',
            message: 'Garden sign-in is unavailable',
          }),
        )
      const expiry = page.data?.session.expiresAt
      expiresAt = expiry ? new Date(expiry).getTime() : null
      return page.data?.user.id
        ? Result.ok(page.data.user.id)
        : Result.err(
            new ClientReadFailure({
              code: 'unauthorized',
              message: 'Sign in to Garden',
            }),
          )
    })
  }

  const adapter: MobileAuth = {
    sessionExpiresAt: () => expiresAt,
    createChatSocket: (path) =>
      createNativeChatSocket(origin, path, () => chatCookie),
    session: () => ordered(readSession),
    signIn: (email, password) =>
      ordered(async () => {
        const response = await Result.tryPromise({
          try: () => client.signIn.email({ email, password }),
          catch: () =>
            new ClientReadFailure({
              code: 'transport',
              message: 'Garden could not be reached',
            }),
        })
        return response.match({
          ok: (page) =>
            page.error
              ? Promise.resolve(
                  Result.err(
                    new ClientReadFailure({
                      code: 'unauthorized',
                      message: 'Garden refused sign-in',
                    }),
                  ),
                )
              : readSession(),
          err: (error) => Promise.resolve(Result.err(error)),
        })
      }),
    /**
     * Only same-origin requests receive cookies. Native Fetch supplies the
     * Cookie header because browser cookie credentials do not apply on phones.
     * The server keeps every existing membership and operation permission check.
     */
    fetch: createNativeFetch(origin, globalThis.fetch, () =>
      client.getCookie(),
    ),
    signOut: () =>
      ordered(async () => {
        await Result.tryPromise({
          try: () => client.signOut(),
          catch: () => null,
        })
        // Erase even if the remote sign-out request failed while offline.
        chatCookie = ''
        await storage.setItemAsync(`${prefix}_cookie`, '{}')
        await storage.setItemAsync(`${prefix}_session_data`, '{}')
      }),
  }
  authByOrigin.set(origin, adapter)
  return adapter
}

const privateStorage = {
  get: (key: string) => SecureStore.getItemAsync(key, secureOptions),
  set: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value, secureOptions),
  remove: (key: string) => SecureStore.deleteItemAsync(key, secureOptions),
}
const readCache = createSecureReadCache(privateStorage)
const draftCache = createSecureReadCache(privateStorage, draftKey, 16)

export const nativePorts: MobilePorts = {
  readCache: () => readCache.read(),
  writeCache: (value) => readCache.write(value),
  clearCache: () => readCache.clear(),
  auth: nativeAuth,
  createRequestId: () => Crypto.randomUUID(),
  now: () => Date.now(),
  scheduleExpiry: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs)
    return () => clearTimeout(timer)
  },
  readDraft: () => draftCache.read(),
  writeDraft: (value) => draftCache.write(value),
  clearDraft: () => draftCache.clear(),
}
