import "./_setup-env";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLock: vi.fn(),
  upsertMailServer: vi.fn(),
  release: vi.fn(async () => undefined),
}));

vi.mock("@repo/db", () => ({
  repos: {
    mailServer: {
      upsert: mocks.upsertMailServer,
    },
  },
  tryAcquireAdvisoryLock: mocks.getLock,
}));

import { reserveMailSetup } from "../../../src/modules/mail/mail-setup-lease";

describe("reserveMailSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLock.mockResolvedValue({ release: mocks.release });
    mocks.upsertMailServer.mockResolvedValue({});
  });

  test("returns a held advisory lock after recording setup start", async () => {
    const reservation = await reserveMailSetup("server-1", "example.com");

    expect(mocks.getLock).toHaveBeenCalledWith("mail-setup:server-1");
    expect(mocks.upsertMailServer).toHaveBeenCalledWith({
      serverId: "server-1",
      domain: "example.com",
      installedAt: null,
    });
    expect(reservation).toEqual({ release: mocks.release });
    expect(mocks.release).not.toHaveBeenCalled();
  });

  test("returns null without writing when another replica holds the lock", async () => {
    mocks.getLock.mockResolvedValue(null);

    await expect(reserveMailSetup("server-2", "example.com")).resolves.toBeNull();
    expect(mocks.upsertMailServer).not.toHaveBeenCalled();
  });

  test("releases the advisory lock when recording setup start fails", async () => {
    mocks.upsertMailServer.mockRejectedValue(new Error("database unavailable"));

    await expect(reserveMailSetup("server-3", "example.com")).rejects.toThrow(
      "database unavailable",
    );
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
});
