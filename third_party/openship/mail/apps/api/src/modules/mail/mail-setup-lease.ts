import { repos, tryAcquireAdvisoryLock, type AdvisoryLockHandle } from "@repo/db";

/** Acquire a cross-replica lock and record the mail setup start. */
export async function reserveMailSetup(
  serverId: string,
  domain: string,
): Promise<AdvisoryLockHandle | null> {
  const lock = await tryAcquireAdvisoryLock(`mail-setup:${serverId}`);
  if (!lock) return null;

  try {
    await repos.mailServer.upsert({ serverId, domain, installedAt: null });
    return lock;
  } catch (err) {
    await lock.release();
    throw err;
  }
}
