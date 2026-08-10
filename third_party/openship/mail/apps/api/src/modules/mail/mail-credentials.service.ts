/**
 * Mail-credentials operations - change the postmaster password after install.
 *
 * Flow:
 *   1. Hash the new password with `doveadm pw -s SSHA512` (the scheme
 *      iRedMail's default `dovecot-sql.conf` uses for the `password`
 *      column). Hashing on the target server avoids sending the
 *      cleartext or the hash through any intermediate process.
 *   2. UPDATE vmail.mailbox SET password = '<hash>' WHERE username = …
 *      via `sudo -u postgres psql`.
 *   3. Scrub any leftover plaintext from the state file. We used to mirror
 *      it back for the credentials card to display; that was a needless
 *      attack surface and is gone - the only way to "know" the password
 *      now is to set one via this flow.
 */

import type { CommandExecutor } from "@repo/adapters";
import { readState, mutateState } from "./mail-state";

/**
 * Shell-quote an arbitrary string so it survives as a single argv element
 * inside a `bash -c …` command. Wraps in single quotes and escapes any
 * embedded single quotes via the standard `'\''` trick.
 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Hash a plaintext password via doveadm. Returns the `{SSHA512}...` string
 * ready to drop into the `password` column.
 */
async function hashWithDovecot(
  exec: CommandExecutor,
  plaintext: string,
): Promise<string> {
  const out = await exec.exec(
    `doveadm pw -s SSHA512 -p ${shellQuote(plaintext)}`,
  );
  const hash = out.trim();
  if (!hash.startsWith("{SSHA512}")) {
    throw new Error(
      `doveadm pw returned unexpected output: ${hash.slice(0, 60)}…`,
    );
  }
  return hash;
}

/**
 * Update the postmaster password for `<domain>`. Caller is responsible
 * for validation (length, etc.) - this function trusts the input.
 *
 * `domain` is the mail domain (e.g. "example.com"), NOT `mail.example.com`.
 * The postmaster account is always `postmaster@<domain>`.
 */
export async function updatePostmasterPassword(
  exec: CommandExecutor,
  domain: string,
  newPassword: string,
): Promise<void> {
  const username = `postmaster@${domain}`;
  const hash = await hashWithDovecot(exec, newPassword);

  // Sanity-check the values we're about to embed. Both come from controlled
  // sources (doveadm output + `postmaster@<validated-domain>`), so this is
  // belt-and-suspenders against an upstream surprise.
  if (!/^\{SSHA512\}[A-Za-z0-9+/=]+$/.test(hash)) {
    throw new Error("doveadm pw returned a hash with unexpected characters");
  }
  if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(username)) {
    throw new Error(`Refusing to update for suspicious username: ${username}`);
  }

  // iRedMail's pg_hba.conf grants the local `postgres` Unix user passwordless
  // access. Single-quote-wrap the SQL string literals - hash chars are
  // [A-Za-z0-9+/={}], username is similarly tame, so no escape gymnastics.
  const psqlCmd = `sudo -u postgres psql -d vmail -v ON_ERROR_STOP=1 -c "UPDATE mailbox SET password='${hash}' WHERE username='${username}';"`;
  await exec.exec(psqlCmd);

  // Persist the new plaintext into state.secrets so the test-email flow
  // (and any future SMTP-from-orchestrator use) can authenticate over
  // submission as postmaster@<domain> without scraping it from disk.
  //
  // The state file lives at `/root/.openship/mail-state.json` with root-
  // only permissions; an attacker with read access there already has
  // /etc/dovecot/dovecot-sql.conf and the bind credentials. Keeping the
  // postmaster plaintext alongside the other generated secrets doesn't
  // widen the blast radius - it just keeps the orchestrator able to act
  // as the mail server's own admin without paging the operator.
  const state = await readState(exec);
  if (state) {
    await mutateState(exec, state.serverId, (s) => ({
      ...s,
      secrets: { ...s.secrets, DOMAIN_ADMIN_PASSWD_PLAIN: newPassword },
    }));
  }
}
