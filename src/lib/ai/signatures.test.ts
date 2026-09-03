import { describe, it, expect } from "vitest";
import {
  sha1Hex,
  tabSetSignature,
  analyticsSignature,
  modelSetSignature,
  pageSignature,
  type DaySigInput,
  type TabSigInput,
} from "./signatures";

describe("sha1Hex", () => {
  it("matches the RFC 3174 test vectors", () => {
    expect(sha1Hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(sha1Hex("The quick brown fox jumps over the lazy dog")).toBe(
      "2fd4e1c67a2d28fced849ee1bb76e7391b93eb12",
    );
  });

  it("handles multi-block and multibyte input against reference vectors", () => {
    expect(sha1Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "84983e441c3bd26ebaae4aa1f95129e5e54670f1",
    );
    expect(sha1Hex("a".repeat(64))).toBe("0098ba824b5c16427bd7a1122a5a442a25ec644d");
    expect(sha1Hex("é日本")).toBe("e55eeff7fe0866f8fe443dc5f88b41202db7015d");
  });

  it("is deterministic", () => {
    expect(sha1Hex("same input")).toBe(sha1Hex("same input"));
  });
});

describe("tabSetSignature", () => {
  const tabs = [
    { id: 1, title: "Tokyo flights", url: "https://a.com/f", domain: "a.com", openedAt: 100, visitCount: 2 },
    { id: 2, title: "AWS", url: "https://aws.amazon.com", domain: "aws.amazon.com", openedAt: 200, visitCount: 1 },
  ];

  it("is order-independent", () => {
    const reversed = [...tabs].reverse();
    expect(tabSetSignature(reversed)).toBe(tabSetSignature(tabs));
  });

  it("changes when a title changes", () => {
    const changed = [{ ...tabs[0], title: "Tokyo hotels" }, tabs[1]];
    expect(tabSetSignature(changed)).not.toBe(tabSetSignature(tabs));
  });

  it("changes when the tab set gains or loses a member", () => {
    expect(tabSetSignature([tabs[0]])).not.toBe(tabSetSignature(tabs));
    expect(tabSetSignature([...tabs, { id: 3, title: "x", url: "u", domain: "d", openedAt: 1, visitCount: 0 }])).not.toBe(
      tabSetSignature(tabs),
    );
  });

  it("is stable across optional-field absence", () => {
    const minimal = { id: 1, title: "t" };
    expect(tabSetSignature([minimal])).toBe(
      tabSetSignature([{ id: 1, title: "t", url: "", domain: "", openedAt: 0, visitCount: 0 }]),
    );
  });

  it("ignores churny fields like lastActiveAt", () => {
    expect(tabSetSignature([{ ...tabs[0], lastActiveAt: 999 } as TabSigInput])).toBe(
      tabSetSignature([tabs[0]]),
    );
  });

  it("is injective when a title embeds the old delimiter", () => {
    // Under a naive "|"-join these two sets were identical — "1|a|b|c" vs "1|a|b|c".
    const a: TabSigInput = { id: 1, title: "a|b", url: "c" };
    const b: TabSigInput = { id: 1, title: "a", url: "b|c" };
    expect(tabSetSignature([a])).not.toBe(tabSetSignature([b]));
  });
});

describe("analyticsSignature", () => {
  const days: DaySigInput[] = [
    { date: "2026-09-01", opened: 5, closed: 2, peak: 40, debt: 60, domainTime: { "a.com": 100, "b.com": 50 } },
    { date: "2026-09-02", opened: 3, closed: 4, peak: 38, debt: 55, domainTime: {} },
  ];

  it("is order-independent", () => {
    expect(analyticsSignature([...days].reverse())).toBe(analyticsSignature(days));
  });

  it("changes when any metric changes", () => {
    const changed = [{ ...days[0], debt: 99 }, days[1]];
    expect(analyticsSignature(changed)).not.toBe(analyticsSignature(days));
  });

  it("is stable across domainTime key insertion order", () => {
    const swapped: DaySigInput[] = [
      { ...days[0], domainTime: { "b.com": 50, "a.com": 100 } },
      days[1],
    ];
    expect(analyticsSignature(swapped)).toBe(analyticsSignature(days));
  });

  it("changes when a domain's time changes", () => {
    const changed: DaySigInput[] = [
      { ...days[0], domainTime: { "a.com": 99, "b.com": 50 } },
      days[1],
    ];
    expect(analyticsSignature(changed)).not.toBe(analyticsSignature(days));
  });
});

describe("modelSetSignature / pageSignature", () => {
  it("model set is order-independent", () => {
    expect(modelSetSignature(["b", "a"])).toBe(modelSetSignature(["a", "b"]));
  });

  it("page signature changes on content change", () => {
    expect(pageSignature("t", "body")).not.toBe(pageSignature("t", "other"));
  });
});