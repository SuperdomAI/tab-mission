import { describe, it, expect } from "vitest";
import { resolveReopenTarget } from "./reopen";

describe("resolveReopenTarget", () => {
  it("picks the most recent TAB-level close", () => {
    const entries = [
      { lastModified: 3, window: { sessionId: "w1" } },
      { lastModified: 2, tab: { sessionId: "t2", title: "Video", url: "https://youtube.com" } },
      { lastModified: 1, tab: { sessionId: "t1", title: "Inbox", url: "https://mail.google.com" } },
    ];
    expect(resolveReopenTarget(entries)).toEqual({
      entry: { sessionId: "t2", title: "Video", url: "https://youtube.com" },
    });
  });

  it("skips window-level entries — a whole window must never auto-restore", () => {
    const entries = [
      { lastModified: 5, window: { sessionId: "w1" } },
      { lastModified: 1, tab: { sessionId: "t1", title: "Inbox", url: "https://mail.google.com" } },
    ];
    expect(resolveReopenTarget(entries)).toEqual({
      entry: { sessionId: "t1", title: "Inbox", url: "https://mail.google.com" },
    });
  });

  it("errors when nothing closable exists", () => {
    expect(resolveReopenTarget([])).toEqual({ error: "empty" });
    expect(resolveReopenTarget([{ window: { sessionId: "w1" } }])).toEqual({
      error: "empty",
    });
    expect(resolveReopenTarget([{ tab: { title: "No id" } }])).toEqual({
      error: "empty",
    });
  });
});