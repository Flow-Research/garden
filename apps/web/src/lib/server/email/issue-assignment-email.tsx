export type IssueAssignmentEmailProps = {
  issueTitle: string
  taskUrl: string
  assignerName: string
  workspaceName: string
  assigneeEmail: string
}

const colors = {
  parchment: '#f2f0eb',
  vellum: '#fbfaf6',
  ink: '#263029',
  gravel: '#756f66',
  slate: '#999187',
  hairline: '#d9d3ca',
  brand: '#4d9864',
  sageWash: '#dcebdd',
  peachWash: '#efe2d2',
  duskWash: '#e9dde5',
}

/**
 * Renders the "you were assigned a task" email as Worker-safe HTML, mirroring the
 * invitation email (same palette, one wide reading column, single CTA) because
 * the `react-email` bundle breaks workerd SSR locally. The task title is the
 * serif headline so the recipient sees what they own before any chrome; the CTA
 * lands them in the assignee's workspace, where the assignment inbox item
 * (written alongside this send) surfaces the task — there is no per-issue route
 * to deep-link yet, only `/workspace?workspace_id=`.
 */
export function renderIssueAssignmentEmailHtml(props: IssueAssignmentEmailProps) {
  const safe = {
    issueTitle: escapeHtml(props.issueTitle),
    taskUrl: escapeHtml(props.taskUrl),
    taskHref: escapeAttribute(props.taskUrl),
    assignerName: escapeHtml(props.assignerName),
    workspaceName: escapeHtml(props.workspaceName),
    assigneeEmail: escapeHtml(props.assigneeEmail),
  }

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>${safe.assignerName} assigned you a task on Garden</title>
    <style>
      @media (max-width: 640px) {
        .garden-frame { padding: 22px 14px !important; }
        .garden-panel { padding: 30px 22px 26px !important; }
        .garden-title { font-size: 28px !important; line-height: 33px !important; }
        .garden-meta-copy { display: block !important; padding: 2px 0 !important; }
        .garden-dot { display: none !important; }
      }
    </style>
  </head>
  <body style="margin:0;background:${colors.parchment};color:${colors.ink};font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${safe.assignerName} assigned you "${safe.issueTitle}" in ${safe.workspaceName}.
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${colors.parchment};background-image:radial-gradient(circle at 16% 12%, ${colors.sageWash} 0, transparent 34%), radial-gradient(circle at 86% 20%, ${colors.duskWash} 0, transparent 30%), radial-gradient(circle at 22% 92%, ${colors.peachWash} 0, transparent 32%);">
      <tr>
        <td align="center" class="garden-frame" style="padding:38px 18px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;margin:0 auto;">
            <tr>
              <td align="center" style="padding:0 0 16px;">
                <div style="color:${colors.ink};font-size:15px;font-weight:600;letter-spacing:-0.01em;line-height:20px;">Garden</div>
                <div style="margin-top:3px;color:${colors.slate};font-size:10px;font-weight:600;letter-spacing:0.18em;line-height:14px;text-transform:uppercase;">Task assignment</div>
              </td>
            </tr>
            <tr>
              <td align="center" class="garden-panel" style="background:${colors.vellum};border:1px solid ${colors.hairline};border-radius:18px;padding:40px 38px 32px;">
                <h1 class="garden-title" style="margin:0 auto;color:${colors.ink};font-family:Fraunces,Georgia,'Times New Roman',serif;font-size:34px;font-weight:300;letter-spacing:-0.02em;line-height:39px;text-align:center;">
                  ${safe.issueTitle}
                </h1>
                <p style="max-width:390px;margin:16px auto 0;color:${colors.gravel};font-size:15px;line-height:24px;text-align:center;">
                  <span style="color:${colors.ink};font-weight:600;">${safe.assignerName}</span> assigned this task to you in <span style="color:${colors.ink};font-weight:600;">${safe.workspaceName}</span>.
                </p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:30px auto 34px;">
                  <tr>
                    <td bgcolor="${colors.ink}" style="border:1px solid ${colors.ink};border-radius:10px;">
                      <a href="${safe.taskHref}" style="display:inline-block;color:${colors.parchment};font-size:14px;font-weight:600;line-height:18px;padding:12px 18px;text-decoration:none;">
                        View task
                      </a>
                    </td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid ${colors.hairline};border-bottom:1px solid ${colors.hairline};margin:0 auto;">
                  <tr>
                    <td align="center" style="padding:17px 10px;color:${colors.gravel};font-size:12px;line-height:20px;text-align:center;">
                      <span class="garden-meta-copy" style="display:inline-block;padding:0 3px;"><span style="color:${colors.slate};font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">For</span> <span style="color:${colors.ink};">${safe.assigneeEmail}</span></span>
                      <span class="garden-dot" style="color:${colors.hairline};padding:0 5px;">•</span>
                      <span class="garden-meta-copy" style="display:inline-block;padding:0 3px;"><span style="color:${colors.slate};font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">From</span> <span style="color:${colors.ink};">${safe.assignerName}</span></span>
                      <span class="garden-dot" style="color:${colors.hairline};padding:0 5px;">•</span>
                      <span class="garden-meta-copy" style="display:inline-block;padding:0 3px;"><span style="color:${colors.slate};font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">In</span> <span style="color:${colors.ink};">${safe.workspaceName}</span></span>
                    </td>
                  </tr>
                </table>
                <p style="max-width:410px;margin:20px auto 0;color:${colors.gravel};font-size:12px;line-height:19px;text-align:center;">
                  Button not working? Paste this link:<br />
                  <a href="${safe.taskHref}" style="color:${colors.brand};text-decoration:underline;word-break:break-all;">${safe.taskUrl}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:14px 24px 0;color:${colors.slate};font-size:11px;line-height:17px;text-align:center;">
                Garden is a workspace for tending agents, issues, and active work.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

/** Escapes text nodes so task/assigner metadata cannot break email markup. */
function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** Escapes URL attributes; same rules as text plus explicit control-char strip. */
function escapeAttribute(value: string) {
  return Array.from(escapeHtml(value))
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join('')
}
