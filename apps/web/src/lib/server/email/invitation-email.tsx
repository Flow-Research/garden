export type InvitationEmailProps = {
  expiresAt: string | null
  invitationUrl: string
  invitedEmail: string
  inviterEmail: string
  inviterName: string
  organizationName: string
  role: string
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
 * Renders the Garden invitation as Worker-safe HTML instead of Resend's
 * `react` prop. The arrangement is intentionally centered and calm: one invite
 * moment, one CTA, then compact metadata. No status strip or dashboard-like
 * layout, because an invite email should feel balanced rather than operational.
 */
export function renderInvitationEmailHtml(props: InvitationEmailProps) {
  const safe = {
    expiresAt: props.expiresAt ? escapeHtml(props.expiresAt) : null,
    invitationUrl: escapeHtml(props.invitationUrl),
    invitationHref: escapeAttribute(props.invitationUrl),
    invitedEmail: escapeHtml(props.invitedEmail),
    inviterEmail: escapeHtml(props.inviterEmail),
    inviterName: escapeHtml(props.inviterName),
    organizationName: escapeHtml(props.organizationName),
    role: escapeHtml(props.role),
  }

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>Join ${safe.organizationName} on Garden</title>
    <style>
      @media (max-width: 640px) {
        .garden-frame { padding: 22px 14px !important; }
        .garden-panel { padding: 30px 22px 26px !important; }
        .garden-title { font-size: 30px !important; line-height: 35px !important; }
        .garden-meta-copy { display: block !important; padding: 2px 0 !important; }
        .garden-dot { display: none !important; }
      }
    </style>
  </head>
  <body style="margin:0;background:${colors.parchment};color:${colors.ink};font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${safe.inviterName} invited you to join ${safe.organizationName} on Garden.
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${colors.parchment};background-image:radial-gradient(circle at 16% 12%, ${colors.sageWash} 0, transparent 34%), radial-gradient(circle at 86% 20%, ${colors.duskWash} 0, transparent 30%), radial-gradient(circle at 22% 92%, ${colors.peachWash} 0, transparent 32%);">
      <tr>
        <td align="center" class="garden-frame" style="padding:38px 18px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;margin:0 auto;">
            <tr>
              <td align="center" style="padding:0 0 16px;">
                <div style="color:${colors.ink};font-size:15px;font-weight:600;letter-spacing:-0.01em;line-height:20px;">Garden</div>
                <div style="margin-top:3px;color:${colors.slate};font-size:10px;font-weight:600;letter-spacing:0.18em;line-height:14px;text-transform:uppercase;">Workspace invitation</div>
              </td>
            </tr>
            <tr>
              <td align="center" class="garden-panel" style="background:${colors.vellum};border:1px solid ${colors.hairline};border-radius:18px;padding:40px 38px 32px;">
                <h1 class="garden-title" style="margin:0 auto;color:${colors.ink};font-family:Fraunces,Georgia,'Times New Roman',serif;font-size:36px;font-weight:300;letter-spacing:-0.02em;line-height:41px;text-align:center;">
                  Join ${safe.organizationName}
                </h1>
                <p style="max-width:390px;margin:16px auto 0;color:${colors.gravel};font-size:15px;line-height:24px;text-align:center;">
                  ${safe.inviterName} invited you into <span style="color:${colors.ink};font-weight:600;">${safe.organizationName}</span> as a ${safe.role}.
                </p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:30px auto 34px;">
                  <tr>
                    <td bgcolor="${colors.ink}" style="border:1px solid ${colors.ink};border-radius:10px;">
                      <a href="${safe.invitationHref}" style="display:inline-block;color:${colors.parchment};font-size:14px;font-weight:600;line-height:18px;padding:12px 18px;text-decoration:none;">
                        Accept invite
                      </a>
                    </td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid ${colors.hairline};border-bottom:1px solid ${colors.hairline};margin:0 auto;">
                  <tr>
                    <td align="center" style="padding:17px 10px;color:${colors.gravel};font-size:12px;line-height:20px;text-align:center;">
                      <span class="garden-meta-copy" style="display:inline-block;padding:0 3px;"><span style="color:${colors.slate};font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">For</span> <span style="color:${colors.ink};">${safe.invitedEmail}</span></span>
                      <span class="garden-dot" style="color:${colors.hairline};padding:0 5px;">•</span>
                      <span class="garden-meta-copy" style="display:inline-block;padding:0 3px;"><span style="color:${colors.slate};font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">From</span> <span style="color:${colors.ink};">${safe.inviterName}</span></span>
                      ${safe.expiresAt ? `<span class="garden-dot" style="color:${colors.hairline};padding:0 5px;">•</span><span class="garden-meta-copy" style="display:inline-block;padding:0 3px;"><span style="color:${colors.slate};font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">Expires</span> <span style="color:${colors.ink};">${safe.expiresAt}</span></span>` : ''}
                    </td>
                  </tr>
                </table>
                <p style="max-width:410px;margin:20px auto 0;color:${colors.gravel};font-size:12px;line-height:19px;text-align:center;">
                  Button not working? Paste this link:<br />
                  <a href="${safe.invitationHref}" style="color:${colors.brand};text-decoration:underline;word-break:break-all;">${safe.invitationUrl}</a>
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

/** Escapes text nodes so invite metadata cannot break email markup. */
function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** Escapes URL attributes; currently same rules as text plus explicit control chars. */
function escapeAttribute(value: string) {
  return Array.from(escapeHtml(value))
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join('')
}
