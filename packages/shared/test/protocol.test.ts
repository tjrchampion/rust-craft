import { describe, expect, it } from "vitest";
import { ClientMsg, DodgeMsg } from "../src/protocol";

describe("protocol validation", () => {
  it("dodge messages only allow dirX and dirZ", () => {
    expect(DodgeMsg.safeParse({ t: "dodge", dirX: 0.5, dirZ: -0.5 }).success).toBe(true);
    expect(DodgeMsg.safeParse({ t: "dodge", dirX: 0.5, dirZ: -0.5, tx: 10, tz: 10 }).success).toBe(false);
    expect(ClientMsg.safeParse({ t: "dodge", dirX: 0.5, dirZ: -0.5 }).success).toBe(true);
    expect(ClientMsg.safeParse({ t: "dodge", dirX: 0.5, dirZ: -0.5, tx: 10, tz: 10 }).success).toBe(false);
  });

  it("selectTarget messages allow string targetId or null", () => {
    expect(ClientMsg.safeParse({ t: "selectTarget", targetId: "enemy-123" }).success).toBe(true);
    expect(ClientMsg.safeParse({ t: "selectTarget", targetId: null }).success).toBe(true);
    expect(ClientMsg.safeParse({ t: "selectTarget", targetId: 123 }).success).toBe(false);
  });

  it("moveItem messages allow crafting container", () => {
    expect(ClientMsg.safeParse({ t: "moveItem", fromContainer: "inventory", fromSlot: 0, toContainer: "crafting", toSlot: 5 }).success).toBe(true);
    expect(ClientMsg.safeParse({ t: "moveItem", fromContainer: "crafting", fromSlot: 5, toContainer: "hotbar", toSlot: 0 }).success).toBe(true);
  });

  it("shareQuest messages validate correctly", () => {
    expect(ClientMsg.safeParse({ t: "shareQuest", questId: "q_v0_wolves" }).success).toBe(true);
    expect(ClientMsg.safeParse({ t: "shareQuest" }).success).toBe(false);
    expect(ClientMsg.safeParse({ t: "shareQuest", questId: 123 }).success).toBe(false);
  });
});
