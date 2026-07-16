import { describe, expect, it } from "vitest";
import { ClientMsg, DodgeMsg } from "../src/protocol";

describe("protocol validation", () => {
  it("dodge messages only allow dirX and dirZ", () => {
    expect(DodgeMsg.safeParse({ t: "dodge", dirX: 0.5, dirZ: -0.5 }).success).toBe(true);
    expect(DodgeMsg.safeParse({ t: "dodge", dirX: 0.5, dirZ: -0.5, tx: 10, tz: 10 }).success).toBe(false);
    expect(ClientMsg.safeParse({ t: "dodge", dirX: 0.5, dirZ: -0.5 }).success).toBe(true);
    expect(ClientMsg.safeParse({ t: "dodge", dirX: 0.5, dirZ: -0.5, tx: 10, tz: 10 }).success).toBe(false);
  });
});
