import { describe, expect, it } from "vitest";
import { matchMentions } from "./server";

const abiolaId = "3eb3bd46-e693-4c9d-8dff-d0e45efa42c6";
const gardenId = "11111111-1111-4111-8111-111111111111";
const candidates = {
  agents: [{ id: gardenId, name: "Garden" }],
  members: [
    { id: abiolaId, name: "abiola adeshina", email: "a.adeshina@example.com" },
  ],
};

describe("matchMentions", () => {
  it("resolves a mention://member link for a two-word name", () => {
    expect(
      matchMentions(
        `hi [@abiola adeshina](mention://member/${abiolaId}) review this`,
        candidates,
      ),
    ).toEqual({ agents: [], users: [abiolaId] });
  });

  it("resolves mention://agent links", () => {
    expect(
      matchMentions(`[@Garden](mention://agent/${gardenId}) go`, candidates),
    ).toEqual({ agents: [gardenId], users: [] });
  });

  it("ignores forged or foreign ids", () => {
    expect(
      matchMentions(
        "[@abiola adeshina](mention://member/99999999-9999-4999-8999-999999999999)",
        candidates,
      ),
    ).toEqual({ agents: [], users: [] });
  });

  it("keeps typed @token matching", () => {
    expect(
      matchMentions("ping @abiolaadeshina and @garden", candidates),
    ).toEqual({
      agents: [gardenId],
      users: [abiolaId],
    });
  });
});
