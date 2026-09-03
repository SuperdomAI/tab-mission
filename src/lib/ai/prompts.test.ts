import { describe, it, expect } from "vitest";
import {
  TRIAGE_TAB_CAP,
  buildDebriefPrompt,
  buildTriagePrompt,
  buildIdleDraftPrompt,
  buildSuggestionsPrompt,
  buildSessionSummaryPrompt,
  buildSummarizePagePrompt,
  buildQueryIntentPrompt,
  buildCoachPrompt,
} from "./prompts";

const tab = (id: number) => ({
  id,
  title: `Title ${id}`,
  domain: `domain${id}.com`,
  openedAt: 1_700_000_000_000,
  visitCount: 1,
});

const many = Array.from({ length: 60 }, (_, i) => tab(i + 1));

describe("every prompt", () => {
  it("demands JSON-only output (no prose, no fences)", () => {
    const all = [
      buildDebriefPrompt({
        date: "2026-09-03",
        domains: ["a.com"],
        opened: 5,
        closed: 2,
        peak: 30,
        debt: 60,
      }),
      buildTriagePrompt([tab(1)]),
      buildSuggestionsPrompt([tab(1)]),
      buildSessionSummaryPrompt({ name: "s", tabs: [{ title: "t", url: "u" }] }),
      buildSummarizePagePrompt({ title: "t", text: "body" }),
      buildQueryIntentPrompt("q"),
      buildCoachPrompt([
        { date: "2026-08-01", domains: ["a.com"], opened: 1, closed: 1, debt: 10 },
      ]),
    ];
    for (const prompt of all) {
      expect(prompt).toMatch(/ONLY JSON/);
      expect(prompt).not.toMatch(/```/);
    }
  });

  it("frames web-controlled context (titles/page text) as untrusted data in every content-bearing prompt", () => {
    const prompts = [
      buildTriagePrompt([tab(1)]),
      buildSuggestionsPrompt([tab(1)]),
      buildSessionSummaryPrompt({ name: "s", tabs: [{ title: "t", url: "u" }] }),
      buildSummarizePagePrompt({ title: "t", text: "body" }),
    ];
    for (const prompt of prompts) {
      expect(prompt).toMatch(/UNTRUSTED/);
    }
  });
});

describe("buildTriagePrompt", () => {
  it("lists every tab id/title/domain/meta", () => {
    const p = buildTriagePrompt([tab(1), tab(2)]);
    expect(p).toContain("1: Title 1 (domain1.com)");
    expect(p).toContain("2: Title 2 (domain2.com)");
    expect(p).toContain("1 visits");
  });

  it("caps the tab list at TRIAGE_TAB_CAP and reports the listed count", () => {
    const p = buildTriagePrompt(many);
    expect(p).toContain(`Tabs (${TRIAGE_TAB_CAP}):`);
    expect(p).toContain(`${TRIAGE_TAB_CAP}:`);
    expect(p).not.toContain(`${TRIAGE_TAB_CAP + 1}:`);
  });

  it("lists exactly 40 tabs at the boundary and 41+ is still capped", () => {
    const exact = buildTriagePrompt(many.slice(0, 40));
    const lineCount = (s: string) => s.split("\n").filter((l) => /^\d+: /.test(l)).length;
    expect(lineCount(exact)).toBe(40);
    expect(lineCount(buildTriagePrompt(many))).toBe(40);
  });

  it("forbids id 0 and demands ids from the list", () => {
    const p = buildTriagePrompt([tab(1)]);
    expect(p).toContain("tabId must be one of the ids listed above (never 0)");
    expect(p).not.toContain('"tabId": 0');
  });

  it("offers the allowed category set", () => {
    const p = buildTriagePrompt([tab(1)]);
    expect(p).toContain('"duplicate" | "same-thread" | "stale" | "unvisited" | "junk"');
  });
});

describe("buildIdleDraftPrompt", () => {
  it("is the same decision as triage", () => {
    expect(buildIdleDraftPrompt([tab(1)])).toBe(buildTriagePrompt([tab(1)]));
  });
});

describe("buildSuggestionsPrompt", () => {
  it("lists tabs with optional window ids and caps suggestions at 2", () => {
    const p = buildSuggestionsPrompt([{ id: 1, title: "a", domain: "d", windowId: 3 }]);
    expect(p).toContain("1: a (d) [window 3]");
    expect(p).toMatch(/at most 2 groups/);
    expect(p).toContain("tabIds");
  });

  it("caps the tab list at TRIAGE_TAB_CAP like triage", () => {
    const p = buildSuggestionsPrompt(
      Array.from({ length: 60 }, (_, i) => ({ id: i + 1, title: `t${i + 1}`, domain: "d" })),
    );
    expect(p).toContain(`Open tabs (${TRIAGE_TAB_CAP}):`);
    expect(p).not.toContain(`${TRIAGE_TAB_CAP + 1}: t`);
  });
});

describe("buildSessionSummaryPrompt", () => {
  it("references the session name, past tense, and every tab title", () => {
    const p = buildSessionSummaryPrompt({
      name: "Research",
      tabs: [
        { title: "Paper A", url: "https://a/x" },
        { title: "Paper B", url: "https://b/y" },
      ],
    });
    expect(p).toContain("Research");
    expect(p).toContain("past tense");
    expect(p).toContain("Paper A");
    expect(p).toContain("Paper B");
    expect(p).toContain("5 lines");
  });
});

describe("buildSummarizePagePrompt", () => {
  it("truncates page text to ~6k chars and keeps the title", () => {
    const p = buildSummarizePagePrompt({ title: "Long page", text: "x".repeat(12000) });
    expect(p).toContain("Long page");
    expect(p).toContain("x".repeat(6000));
    expect(p).not.toContain("x".repeat(6001));
    expect(p).toContain("whyItMatters");
  });
});

describe("buildQueryIntentPrompt", () => {
  it("embeds the query and the intent enum", () => {
    const p = buildQueryIntentPrompt("flight to tokyo");
    expect(p).toContain('"flight to tokyo"');
    expect(p).toContain("topic | exact-match | action");
  });
});

describe("buildDebriefPrompt / buildCoachPrompt", () => {
  it("debrief includes date, counts, debt and domains", () => {
    const p = buildDebriefPrompt({
      date: "2026-09-03",
      domains: ["a.com", "b.com"],
      opened: 5,
      closed: 2,
      peak: 30,
      debt: 60,
    });
    expect(p).toContain("2026-09-03");
    expect(p).toContain("Tabs opened: 5");
    expect(p).toContain("peak open: 30");
    expect(p).toContain("Tab-debt score (0-100, higher = more chaos): 60");
    expect(p).toContain("a.com");
    expect(p).toContain("b.com");
    expect(p).toContain("no guilt-tripping");
  });

  it("coach includes the full window and severity enum", () => {
    const p = buildCoachPrompt([
      { date: "2026-08-01", domains: ["a.com"], opened: 1, closed: 1, debt: 10 },
      { date: "2026-08-02", domains: [], opened: 0, closed: 0, debt: 5 },
    ]);
    expect(p).toContain("2026-08-01");
    expect(p).toContain("2026-08-02");
    expect(p).toContain('"notice" | "pattern" | "concern"');
    expect(p).toContain("30-day browser-usage window");
  });
});