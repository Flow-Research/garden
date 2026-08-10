/**
 * Maildir path generation + on-disk creation.
 *
 * iRedMail's convention (matches iRedAdmin's `iredutils.generate_maildir_path`):
 *
 *   <storagebasedirectory>/<storagenode>/<domain>/<u>/<us>/<user>-<YYYYMMDDHHMMSS>/
 *
 * The {u, us} hash segments distribute users across two levels of
 * subdirectories so a domain with many mailboxes doesn't end up as one
 * huge inode listing. The trailing timestamp lets the same local-part be
 * re-created after a hard delete without colliding with leftover files
 * (iRedAdmin uses the same trick).
 *
 * Storage layout for openship:
 *   storagebasedirectory = "/var/vmail"   (iRedMail default)
 *   storagenode          = "vmail1"        (iRedMail default; one node only)
 *
 * Both are stored in `vmail.mailbox` columns of the same names so Dovecot's
 * `userdb` query returns them and the LDA places mail in the right path.
 */

import type { CommandExecutor } from "@repo/adapters";
import { sshManager } from "../../../lib/ssh-manager";

export const STORAGE_BASE = "/var/vmail";
export const STORAGE_NODE = "vmail1";

export interface MaildirLayout {
  storagebasedirectory: string;
  storagenode: string;
  /** Relative path under <storage_base>/<storage_node>/ - what goes in vmail.mailbox.maildir. */
  maildir: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function timestampSuffix(now: Date): string {
  return (
    `${now.getUTCFullYear()}` +
    `${pad2(now.getUTCMonth() + 1)}` +
    `${pad2(now.getUTCDate())}` +
    `${pad2(now.getUTCHours())}` +
    `${pad2(now.getUTCMinutes())}` +
    `${pad2(now.getUTCSeconds())}`
  );
}

/**
 * Compute the maildir layout for a new mailbox. Pure function - does not
 * touch the network.
 *
 *   generateMaildir("acme.com", "alice")
 *   → {
 *       storagebasedirectory: "/var/vmail",
 *       storagenode: "vmail1",
 *       maildir: "acme.com/a/al/alice-20260524103000/",
 *     }
 *
 * The trailing slash matches the iRedAdmin convention. Dovecot strips/adds
 * it as needed.
 */
export function generateMaildir(
  domain: string,
  username: string,
  now: Date = new Date(),
): MaildirLayout {
  const u = username.charAt(0).toLowerCase();
  const us = username.slice(0, 2).toLowerCase().padEnd(2, u);
  return {
    storagebasedirectory: STORAGE_BASE,
    storagenode: STORAGE_NODE,
    maildir: `${domain}/${u}/${us}/${username}-${timestampSuffix(now)}/`,
  };
}

/**
 * Create the Maildir directory tree on the target VPS:
 *
 *   /var/vmail/vmail1/<maildir>/{cur,new,tmp}
 *
 * Owned by `vmail:vmail` (the system user iRedMail's installer creates) so
 * Postfix/Dovecot can write into it. Mode `0700` per Dovecot's expectation.
 *
 * Idempotent: `mkdir -p` is fine if the path already exists, and `chown`
 * over an existing tree is harmless.
 */
export async function createMaildirOnDisk(
  serverIdOrExec: string | CommandExecutor,
  layout: MaildirLayout,
): Promise<void> {
  const fullPath = `${layout.storagebasedirectory}/${layout.storagenode}/${layout.maildir}`;
  // Trailing slash already in maildir field; we don't need to add it again.
  const cmd = [
    `mkdir -p ${shellQuote(fullPath + "cur")}`,
    `mkdir -p ${shellQuote(fullPath + "new")}`,
    `mkdir -p ${shellQuote(fullPath + "tmp")}`,
    `chown -R vmail:vmail ${shellQuote(fullPath)}`,
    `chmod -R 0700 ${shellQuote(fullPath)}`,
  ].join(" && ");

  if (typeof serverIdOrExec === "string") {
    await sshManager.withExecutor(serverIdOrExec, (exec) => exec.exec(cmd));
  } else {
    await serverIdOrExec.exec(cmd);
  }
}

/**
 * Remove the Maildir directory tree from disk. Used by hard delete.
 *
 * We use `rm -rf` against the computed full path. The path is built from
 * the mailbox row's stored values, never from untrusted input - `vmail`
 * is the only legitimate writer of the maildir column, and the controller
 * has already validated the mailbox exists.
 */
export async function removeMaildirOnDisk(
  serverIdOrExec: string | CommandExecutor,
  layout: MaildirLayout,
): Promise<void> {
  const fullPath = `${layout.storagebasedirectory}/${layout.storagenode}/${layout.maildir}`;
  // Guard: refuse to rm -rf anything that's not under /var/vmail/
  if (!fullPath.startsWith(`${STORAGE_BASE}/`)) {
    throw new Error(
      `Refusing to remove maildir outside ${STORAGE_BASE}/: ${fullPath}`,
    );
  }
  const cmd = `rm -rf ${shellQuote(fullPath)}`;
  if (typeof serverIdOrExec === "string") {
    await sshManager.withExecutor(serverIdOrExec, (exec) => exec.exec(cmd));
  } else {
    await serverIdOrExec.exec(cmd);
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
