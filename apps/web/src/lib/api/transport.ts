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

  getWorkspaceId(): string | null {
    return this.workspaceId
  }

  setWorkspaceId(id: string | null) {
    this.workspaceId = id
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}
    if (this.workspaceId) headers['X-Workspace-ID'] = this.workspaceId
    return headers
  }

  notifyUnauthorized() {
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
        : payload &&
            payload.error &&
            typeof payload.error === 'object' &&
            'message' in payload.error &&
            typeof payload.error.message === 'string'
          ? payload.error.message
          : fallback

    return new ApiError({
      message,
      status: response.status,
      statusText: response.statusText,
    })
  }

  async request<T>(path: string, init?: ApiRequestInit): Promise<T> {
    const rid = createRequestId()
    const contentType =
      init && 'contentType' in init ? init.contentType : 'application/json'
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
      if (response.status === 401) this.notifyUnauthorized()
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

  /**
   * Uploads multipart form data and reports the percentage of bytes sent.
   *
   * The browser sets the multipart Content-Type boundary automatically.
   */
  async requestFormWithProgress<T>(
    path: string,
    body: FormData,
    onProgress?: (percentage: number) => void,
  ): Promise<T> {
    const requestId = createRequestId()

    return new Promise<T>((resolve, reject) => {
      const request = new XMLHttpRequest()

      request.open('POST', `${this.baseUrl}${path}`)
      request.withCredentials = true
      request.setRequestHeader('X-Request-ID', requestId)

      for (const [name, value] of Object.entries(this.authHeaders())) {
        request.setRequestHeader(name, value)
      }

      request.upload.onprogress = (event) => {
        if (!event.lengthComputable || event.total === 0) return

        const percentage = Math.min(
          100,
          Math.round((event.loaded / event.total) * 100),
        )

        onProgress?.(percentage)
      }

      request.onerror = () => {
        reject(
          new ApiError({
            message: 'Network request failed',
            status: 0,
            statusText: 'Network Error',
          }),
        )
      }

      request.onabort = () => {
        reject(
          new ApiError({
            message: 'Upload cancelled',
            status: 0,
            statusText: 'Abort Error',
          }),
        )
      }

      request.onload = () => {
        if (request.status === 401) this.notifyUnauthorized()

        if (request.status < 200 || request.status >= 300) {
          const response = new Response(request.responseText, {
            status: request.status,
            statusText: request.statusText,
          })

          void this.errorFromResponse(
            response,
            `API error: ${request.status} ${request.statusText}`,
          ).then(reject)

          return
        }

        if (request.status === 204) {
          resolve(undefined as T)
          return
        }

        const payload = Result.try({
          try: () => JSON.parse(request.responseText) as unknown,
          catch: (cause) =>
            new ApiError({
              message: errorMessage(cause, 'Invalid JSON response'),
              status: request.status,
              statusText: request.statusText,
            }),
        })

        if (payload.isErr()) {
          reject(payload.error)
          return
        }

        resolve(payload.value as T)
      }

      request.send(body)
    })
  }

  async requestForm<T>(path: string, body: FormData): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body,
      contentType: null,
    })
  }
}
