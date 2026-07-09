import { Resend } from 'resend'
import { buildIssueDeepLink } from '@garden/core/issues/deep-link'
import { createLogger } from '@garden/observability/console'
import type { AppEnv } from '@/lib/server/env'
import { renderIssueAssignmentEmailHtml } from '@/lib/server/email/issue-assignment-email'

type IssueAssignmentEmailEnv = Pick<AppEnv, 'RESEND_API_KEY'>

const ASSIGNMENT_FROM_EMAIL = 'Garden <hello@garden.flowresearch.tech>'
const logger = createLogger('issue-assignment-email')

type IssueAssignmentEmailData = {
  issue: { id: string; title: string }
  workspace: { id: string; name: string }
  assignee: { email: string }
  assignerName: string
}

type IssueAssignmentEmailInput = {
  baseURL: string
  data: IssueAssignmentEmailData
  env: IssueAssignmentEmailEnv
}

/**
 * Emails a teammate when they are assigned an issue. The PUT /api/issues/$id
 * handler already writes an assignment inbox item for a new human assignee; this
 * adds the out-of-app nudge so work doesn't stall waiting for someone to open the
 * tab. Mirrors sendOrganizationInvitationEmail (Resend, explicit html/text because
 * react-email breaks workerd SSR). Callers invoke this best-effort — a Resend
 * failure must not fail the assignment write — so it throws and the route wraps it
 * in a logged Result.
 */
export async function sendIssueAssignmentEmail({
  baseURL,
  data,
  env,
}: IssueAssignmentEmailInput) {
  const apiKey = readRequiredEnv(env.RESEND_API_KEY, 'RESEND_API_KEY')
  const taskUrl = buildIssueDeepLink(baseURL, data.workspace.id, data.issue.id)
  const subject = `${data.assignerName} assigned you “${data.issue.title}”`
  const html = renderIssueAssignmentEmailHtml({
    issueTitle: data.issue.title,
    taskUrl,
    assignerName: data.assignerName,
    workspaceName: data.workspace.name,
    assigneeEmail: data.assignee.email,
  })
  const text = renderIssueAssignmentEmailText({
    issueTitle: data.issue.title,
    taskUrl,
    assignerName: data.assignerName,
    workspaceName: data.workspace.name,
    assigneeEmail: data.assignee.email,
  })
  const resend = new Resend(apiKey)
  const response = await resend.emails.send({
    from: ASSIGNMENT_FROM_EMAIL,
    to: data.assignee.email,
    subject,
    html,
    text,
    tags: [{ name: 'kind', value: 'issue_assignment' }],
  })

  if (response.error) {
    logger.error('send_failed', {
      errorMessage: response.error.message,
      errorName: response.error.name,
      issueId: data.issue.id,
      provider: 'resend',
      statusCode: response.error.statusCode ?? null,
      toDomain: readEmailDomain(data.assignee.email),
    })
    throw new Error(
      `Resend issue assignment email failed: ${response.error.name} ${response.error.statusCode ?? 'unknown'} ${response.error.message}`,
    )
  }

  return response.data
}

/** Plain-text fallback for clients that block HTML. */
function renderIssueAssignmentEmailText({
  issueTitle,
  taskUrl,
  assignerName,
  workspaceName,
  assigneeEmail,
}: {
  issueTitle: string
  taskUrl: string
  assignerName: string
  workspaceName: string
  assigneeEmail: string
}) {
  return [
    `${assignerName} assigned you “${issueTitle}” in ${workspaceName} on Garden.`,
    '',
    `View task: ${taskUrl}`,
    '',
    `Assigned to: ${assigneeEmail}`,
    `Assigned by: ${assignerName}`,
  ].join('\n')
}

function readEmailDomain(email: string) {
  return email.split('@')[1]?.toLowerCase() ?? 'unknown'
}

function readRequiredEnv(value: string | undefined, name: string) {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`${name} is required to send assignment email`)
  return trimmed
}
