/**
 * Password hashing for vmail.mailbox / vmail.admin rows.
 *
 * iRedMail's default dovecot-sql.conf expects `{SSHA512}<base64>` in the
 * `password` column. Hashing happens ON the target VPS via `doveadm pw`
 * so neither cleartext nor hash transits any intermediate process.
 *
 * This is the same scheme used by `mail-credentials.service.ts` for the
 * postmaster password rotation - kept as a separate small module so the
 * admin services can call it without depending on the broader credentials
 * surface.
 */

import type { CommandExecutor } from "@repo/adapters";
import { sshManager } from "../../../lib/ssh-manager";

const SSHA512_HASH_RE = /^\{SSHA512\}[A-Za-z0-9+/=]+$/;

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Hash a plaintext password via `doveadm pw -s SSHA512`. Returns the raw
 * `{SSHA512}...` string ready to drop into the `password` column.
 *
 * Throws if doveadm returns anything that doesn't match the expected hash
 * format - easier to fail at hash time than to debug a broken auth row.
 */
export async function hashPassword(
  serverIdOrExec: string | CommandExecutor,
  plaintext: string,
): Promise<string> {
  const cmd = `doveadm pw -s SSHA512 -p ${shellQuote(plaintext)}`;
  const out =
    typeof serverIdOrExec === "string"
      ? await sshManager.withExecutor(serverIdOrExec, (exec) => exec.exec(cmd))
      : await serverIdOrExec.exec(cmd);

  const hash = out.trim();
  if (!SSHA512_HASH_RE.test(hash)) {
    throw new Error(
      `doveadm pw returned unexpected output: ${hash.slice(0, 60)}…`,
    );
  }
  return hash;
}
