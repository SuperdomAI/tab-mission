import { describe, expect, it } from "vitest";
import { withTabsLock } from "./tabsLock";

describe("withTabsLock", () => {
  it("serializes concurrent read-modify-write ops (no interleaving)", async () => {
    const order: string[] = [];
    const slow = withTabsLock(async () => {
      order.push("op1:start");
      await new Promise((r) => setTimeout(r, 20));
      order.push("op1:end");
    });
    const fast = withTabsLock(async () => {
      order.push("op2:start");
      order.push("op2:end");
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(["op1:start", "op1:end", "op2:start", "op2:end"]);
  });

  it("keeps the chain alive after a rejected op", async () => {
    await withTabsLock(async () => {
      throw new Error("boom");
    }).catch(() => undefined);
    let ran = false;
    await withTabsLock(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("passes the previous op's result boundary to the next op", async () => {
    let observed = "none";
    await withTabsLock(async () => "first");
    await withTabsLock(async () => {
      observed = "second";
    });
    expect(observed).toBe("second");
  });
});