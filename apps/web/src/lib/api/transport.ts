import { Result } from 'better-result'
import { createRequestId } from '@garden/core/utils'
import { ApiError, errorMessage } from './errors'

export interface ApiTransportOptions {
  onUnauthorized?: () => void
}

export type ApiRequestInit = RequestInit & {
  contentType?: string | null
}

export class ApiTransport {
  private workspaceId: string | null = null
  private options: ApiTransportOptions

  constructor(
    private readonly baseUrl: string,
    options?: ApiTransportOptions,
  ) {
    this.options = options ?? {}
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  setWorkspaceId(id: string | null) {
    this.workspaceId = id
  }

  private readCsrfToken(): string | null {
    if (typeof document === 'undefined') return null
    const match = document.cookie
      .split('; ')
      .find((cookie) => cookie.startsWith('accelerate_csrf='))
    return match ? (match.split('=')[1] ?? null) : null
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}
    if (this.workspaceId) headers['X-Workspace-ID'] = this.workspaceId
    const csrf = this.readCsrfToken()
    if (csrf) headers['X-CSRF-Token'] = csrf
    return headers
  }

  private handleUnauthorized() {
    this.workspaceId = null
    this.options.onUnauthorized?.()
  }

  private async errorFromResponse(response: Response, fallback: string) {
    const parsed = await Result.tryPromise({
      try: async () => (await response.clone().json()) as { error?: unknown },
      catch: () => null,
    })
    const payload = parsed.isOk() ? parsed.value : null
    const message =
      payload && typeof payload.error === 'string' && payload.error
        ? payload.error
        : fallback

    return new ApiError({
      message,
      status: response.status,
      statusText: response.statusText,
    })
  }

  async request<T>(path: string, init?: ApiRequestInit): Promise<T> {
    const rid = createRequestId()
    const contentType = init?.contentType ?? 'application/json'
    const headers: Record<string, string> = {
      ...(contentType ? { 'Content-Type': contentType } : {}),
      'X-Request-ID': rid,
      ...this.authHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    }

    const responseResult = await Result.tryPromise({
      try: async () =>
        await fetch(`${this.baseUrl}${path}`, {
          ...init,
          headers,
          credentials: 'include',
        }),
      catch: (cause) =>
        new ApiError({
          message: errorMessage(cause, 'Network request failed'),
          status: 0,
          statusText: 'Network Error',
        }),
    })

    if (responseResult.isErr()) throw responseResult.error
    const response = responseResult.value

    if (!response.ok) {
      if (response.status === 401) this.handleUnauthorized()
      const error = await this.errorFromResponse(
        response,
        `API error: ${response.status} ${response.statusText}`,
      )
      throw error
    }

    if (response.status === 204) return undefined as T

    const payload = await Result.tryPromise({
      try: async () => (await response.json()) as T,
      catch: (cause) =>
        new ApiError({
          message: errorMessage(cause, 'Invalid JSON response'),
          status: response.status,
          statusText: response.statusText,
        }),
    })

    if (payload.isErr()) throw payload.error
    return payload.value
  }

  async requestForm<T>(path: string, body: FormData): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body,
      contentType: null,
    })
  }
}
