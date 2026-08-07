import { Resend } from 'resend'
import { createLogger } from '@garden/observability/console'
import type { AppEnv } from '@/lib/server/env'
import { renderInvitationEmailHtml } from '@/lib/server/email/invitation-email'

type InvitationEmailEnv = Pick<AppEnv, 'RESEND_API_KEY'>

const INVITATION_FROM_EMAIL = 'Garden <hello@garden.flowresearch.tech>'
const logger = createLogger('invitation-email')

type OrganizationInvitationEmailData = {
  id: string
  role: string
  email: string
  organization: {
    name: string
  }
  invitation: {
    expiresAt?: Date | string | null
  }
  inviter: {
    user: {
      name?: string | null
      email: string
    }
  }
}

type InvitationEmailInput = {
  baseURL: string
  data: OrganizationInvitationEmailData
  env: InvitationEmailEnv
}

/**
 * Sends Better Auth organization invites through Resend because Better Auth only
 * exposes the invitation payload and deliberately does not generate or deliver
 * URLs. Before this hook, member invites stopped at a pending DB row. After it,
 * every invite gets a letter-style email with a Garden accept URL. Sources:
 * Better Auth organization `sendInvitationEmail` type/docs, Cloudflare Workers
 * Resend guide, and TanStack Start Cloudflare Vite plugin docs. We send
 * explicit `html`/`text` because Resend's React rendering path is Node-oriented
 * and the all-in-one `react-email` bundle broke workerd SSR locally.
 */
export async function sendOrganizationInvitationEmail({
  baseURL,
  data,
  env,
}: InvitationEmailInput) {
  const apiKey = readRequiredEnv(env.RESEND_API_KEY, 'RESEND_API_KEY')
  const invitationUrl = buildInvitationUrl(baseURL, data.id)
  const subject = `Join ${data.organization.name} on Garden`
  const emailProps = buildInvitationEmailProps({ data, invitationUrl })
  const html = renderInvitationEmailHtml(emailProps)
  const text = renderInvitationEmailText(emailProps)
  const resend = new Resend(apiKey)
  const response = await resend.emails.send({
    from: INVITATION_FROM_EMAIL,
    to: data.email,
    subject,
    html,
    text,
    tags: [{ name: 'kind', value: 'workspace_invitation' }],
  })

  if (response.error) {
    logger.error('send_failed', {
      errorMessage: response.error.message,
      errorName: response.error.name,
      invitationId: data.id,
      provider: 'resend',
      statusCode: response.error.statusCode ?? null,
      toDomain: readEmailDomain(data.email),
    })
    throw new Error(
      `Resend invitation email failed: ${response.error.name} ${response.error.statusCode ?? 'unknown'} ${response.error.message}`,
    )
  }

  return response.data
}

/**
 * Builds a sign-up-first URL instead of linking directly to Better Auth's
 * POST-only accept endpoint. New invitees land on account creation, while
 * already-authenticated users are redirected by the signup route to the invite
 * review page through the same redirect parameter.
 */
export function buildInvitationUrl(baseURL: string, invitationId: string) {
  const invitePath = `/invitations/${encodeURIComponent(invitationId)}`
  const url = new URL('/signup', baseURL)
  url.searchParams.set('redirect', invitePath)
  return url.href
}

/**
 * Renders a single-column, letter-like email. The user explicitly rejected
 * card-heavy layouts and 2-by-1 grids, so the template keeps one wide reading
 * column, one CTA, and inline CSS for email-client compatibility.
 */
function buildInvitationEmailProps({
  data,
  invitationUrl,
}: {
  data: OrganizationInvitationEmailData
  invitationUrl: string
}) {
  return {
    expiresAt: formatExpiration(data.invitation.expiresAt),
    invitationUrl,
    invitedEmail: data.email,
    inviterEmail: data.inviter.user.email,
    inviterName: data.inviter.user.name?.trim() || data.inviter.user.email,
    organizationName: data.organization.name,
    role: formatRole(data.role),
  }
}

/** Keeps plain-text delivery useful for clients that block HTML. */
function renderInvitationEmailText({
  expiresAt,
  invitationUrl,
  invitedEmail,
  inviterEmail,
  inviterName,
  organizationName,
  role,
}: ReturnType<typeof buildInvitationEmailProps>) {
  const lines = [
    `${inviterName} invited you to join ${organizationName} on Garden as ${articleForRole(role)} ${role}.`,
    '',
    `Accept invitation: ${invitationUrl}`,
    '',
    `Invited email: ${invitedEmail}`,
    `Invited by: ${inviterName} <${inviterEmail}>`,
  ]

  if (expiresAt) lines.push(`Expires: ${expiresAt}`)

  return lines.join('\n')
}

function readEmailDomain(email: string) {
  return email.split('@')[1]?.toLowerCase() ?? 'unknown'
}

function readRequiredEnv(value: string | undefined, name: string) {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`${name} is required to send invitation email`)
  return trimmed
}

function formatRole(role: string) {
  return role.trim().toLowerCase() || 'member'
}

function articleForRole(role: string) {
  return /^[aeiou]/i.test(role) ? 'an' : 'a'
}

function formatExpiration(value: Date | string | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date)
}
