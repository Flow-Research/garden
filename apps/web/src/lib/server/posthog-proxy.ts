import type { AppEnv } from '@/lib/server/env'

const US_API_ORIGIN = 'https://us.i.posthog.com'
const US_ASSETS_ORIGIN = 'https://us-assets.i.posthog.com'
const EU_API_ORIGIN = 'https://eu.i.posthog.com'
const EU_ASSETS_ORIGIN = 'https://eu-assets.i.posthog.com'

function resolvePostHogOrigins(env: AppEnv) {
  const configuredOrigin = env.VITE_PUBLIC_POSTHOG_HOST ?? US_API_ORIGIN
  if (configuredOrigin === EU_API_ORIGIN) {
    return { api: EU_API_ORIGIN, assets: EU_ASSETS_ORIGIN }
  }

  return { api: US_API_ORIGIN, assets: US_ASSETS_ORIGIN }
}

export function isPostHogProxyRequest(request: Request) {
  const pathname = new URL(request.url).pathname
  return pathname === '/ingest' || pathname.startsWith('/ingest/')
}

/**
 * Cloudflare-specific same-origin proxy for the PostHog browser SDK. It uses
 * Garden's existing PostHog host configuration and fixed PostHog upstreams; no
 * additional environment variables are required. The payload is streamed
 * unchanged, and Session Replay remains disabled in the browser SDK.
 */
export async function proxyPostHogRequest(request: Request, env: AppEnv) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET, POST' },
    })
  }

  const requestUrl = new URL(request.url)
  const upstreamPath = requestUrl.pathname.slice('/ingest'.length) || '/'
  const origins = resolvePostHogOrigins(env)
  const upstreamOrigin =
    upstreamPath.startsWith('/static/') || upstreamPath.startsWith('/array/')
      ? origins.assets
      : origins.api
  const upstreamUrl = new URL(upstreamPath, upstreamOrigin)
  upstreamUrl.search = requestUrl.search

  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('x-forwarded-for')
  const clientIp = request.headers.get('cf-connecting-ip')
  if (clientIp) headers.set('x-forwarded-for', clientIp)

  return fetch(
    new Request(upstreamUrl, {
      method: request.method,
      headers,
      body: request.method === 'POST' ? request.body : null,
      redirect: 'manual',
    }),
  )
}
