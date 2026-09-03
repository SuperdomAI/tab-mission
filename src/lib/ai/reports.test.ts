import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseDebriefReport,
  parseCoachReport,
  isoWeekKey,
  debriefReportId,
  coachReportId,
  AIReportCache,
  debriefInputFromDay,
  coachDaysFromAnalytics,
  hasCoachData,
  generateDebrief,
  generateCoach,
  AI_REPORTS_KEY,
} from "./reports";
import type { DailyAnalytics } from "../../types/index";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseDebriefReport", () => {
  it("parses a clean report", () => {
    const text = JSON.stringify({
      summary: "A focused morning, drifting afternoon.",
      sections: [
        { heading: "Morning", text: "Deep work on the launch." },
        { heading: "Afternoon", text: "Lots of tab switching." },
      ],
    });
    expect(parseDebriefReport(text)).toEqual({
      summary: "A focused morning, drifting afternoon.",
      sections: [
        { heading: "Morning", text: "Deep work on the launch." },
        { heading: "Afternoon", text: "Lots of tab switching." },
      ],
    });
  });

  it("recovers JSON from code fences and prose", () => {
    const text = 'Here you go:\n```json\n{"summary":"ok","sections":[]}\n```';
    expect(parseDebriefReport(text)).toEqual({ summary: "ok", sections: [] });
  });

  it("skips malformed sections instead of failing", () => {
    const text = JSON.stringify({
      summary: "ok",
      sections: [
        { heading: "Good", text: "fine" },
        { heading: "", text: "missing heading" },
        { text: "missing heading key" },
        "garbage",
      ],
    });
    expect(parseDebriefReport(text)).toEqual({
      summary: "ok",
      sections: [{ heading: "Good", text: "fine" }],
    });
  });

  it("returns null without a summary", () => {
    expect(parseDebriefReport('{"sections":[]}')).toBeNull();
    expect(parseDebriefReport("")).toBeNull();
    expect(parseDebriefReport("no json at all")).toBeNull();
  });
});

describe("parseCoachReport", () => {
  it("parses insights with valid severities", () => {
    const text = JSON.stringify({
      insights: [
        { text: "You open many tabs after lunch.", severity: "pattern" },
        { text: "Deep work happens before 10am.", severity: "notice" },
        { text: "Debt is climbing this week.", severity: "concern" },
      ],
    });
    expect(parseCoachReport(text)).toEqual({
      insights: [
        { text: "You open many tabs after lunch.", severity: "pattern" },
        { text: "Deep work happens before 10am.", severity: "notice" },
        { text: "Debt is climbing this week.", severity: "concern" },
      ],
    });
  });

  it("skips insights with unknown severities", () => {
    const text = JSON.stringify({
      insights: [
        { text: "valid", severity: "pattern" },
        { text: "invalid severity", severity: "critical" },
      ],
    });
    expect(parseCoachReport(text)).toEqual({
      insights: [{ text: "valid", severity: "pattern" }],
    });
  });

  it("returns null when no insight survives validation", () => {
    expect(parseCoachReport('{"insights":[{"text":"","severity":"pattern"}]}')).toBeNull();
    expect(parseCoachReport("garbage")).toBeNull();
  });
});

describe("isoWeekKey", () => {
  it("formats an ISO week key for a mid-year date", () => {
    // 2026-09-03 (UTC) is a Thursday → week 36 of 2026
    expect(isoWeekKey(new Date("2026-09-03T12:00:00Z"))).toBe("2026-W36");
  });

  it("handles a year boundary (Monday rule)", () => {
    // 2021-01-01 is a Friday → still week 53 of 2020
    expect(isoWeekKey(new Date("2021-01-01T12:00:00Z"))).toBe("2020-W53");
  });

  it("handles the first week of a new year", () => {
    // 2021-01-04 is a Monday → week 1 of 2021
    expect(isoWeekKey(new Date("2021-01-04T12:00:00Z"))).toBe("2021-W01");
  });
});

describe("report ids", () => {
  it("prefixes ids by task so debriefs and coach reports never collide", () => {
    expect(debriefReportId("2026-09-03")).toBe("debrief:2026-09-03");
    expect(coachReportId("2026-W36")).toBe("coach:2026-W36");
    expect(debriefReportId("2026-09-03")).not.toBe(coachReportId("2026-09-03"));
  });
});

describe("AIReportCache", () => {
  const now = new Date("2026-09-03T20:00:00Z").getTime();

  it("stores and returns a fresh entry for the right model and task", () => {
    const cache = AIReportCache.empty().set(
      "debrief:2026-09-03",
      { summary: "s", sections: [] },
      "qwen2.5:7b",
      "debrief",
      now,
    );
    expect(
      cache.get("debrief:2026-09-03", "qwen2.5:7b", "debrief", now),
    ).toEqual({
      result: { summary: "s", sections: [] },
      generatedAt: now,
      model: "qwen2.5:7b",
    });
  });

  it("rejects entries past the task TTL (6 h for debrief)", () => {
    const cache = AIReportCache.empty().set(
      "debrief:2026-09-03",
      { summary: "s", sections: [] },
      "qwen2.5:7b",
      "debrief",
      now,
    );
    expect(cache.get("debrief:2026-09-03", "qwen2.5:7b", "debrief", now + 6 * 3600_000 + 1)).toBeUndefined();
  });

  it("rejects entries produced by a different model", () => {
    const cache = AIReportCache.empty().set(
      "debrief:2026-09-03",
      { summary: "s", sections: [] },
      "llama3.1:8b",
      "debrief",
      now,
    );
    expect(cache.get("debrief:2026-09-03", "qwen2.5:7b", "debrief", now)).toBeUndefined();
  });

  it("set replaces a prior entry for the same id", () => {
    const one = AIReportCache.empty().set("debrief:2026-09-03", { summary: "old", sections: [] }, "m", "debrief", now);
    const two = one.set("debrief:2026-09-03", { summary: "new", sections: [] }, "m", "debrief", now);
    expect(two.toJSON()["debrief:2026-09-03"]?.result).toEqual({ summary: "new", sections: [] });
  });

  it("prunes entries older than 30 days on set", () => {
    const ancient = now - 31 * 86400000;
    const cache = AIReportCache.empty().set(
      "debrief:2026-08-01",
      { summary: "ancient", sections: [] },
      "m",
      "debrief",
      ancient,
    );
    const next = cache.set("debrief:2026-09-03", { summary: "fresh", sections: [] }, "m", "debrief", now);
    expect(next.toJSON()["debrief:2026-08-01"]).toBeUndefined();
    expect(next.toJSON()["debrief:2026-09-03"]).toBeDefined();
  });

  it("fromStorage drops malformed rows but keeps valid ones", () => {
    const raw = {
      "debrief:2026-09-03": { result: { summary: "s", sections: [] }, generatedAt: now, model: "m" },
      "bad:1": { result: "x" },
      "bad:2": "string",
      "bad:3": { result: "x", generatedAt: "yesterday", model: "m" },
    };
    const cache = AIReportCache.fromStorage(raw);
    expect(cache.get("debrief:2026-09-03", "m", "debrief", now)).toBeDefined();
    expect(Object.keys(cache.toJSON())).toEqual(["debrief:2026-09-03"]);
  });

  it("fromStorage rejects non-object input", () => {
    expect(AIReportCache.fromStorage(null).toJSON()).toEqual({});
    expect(AIReportCache.fromStorage([1, 2]).toJSON()).toEqual({});
  });
});

describe("debriefInputFromDay", () => {
  const day: DailyAnalytics = {
    date: "2026-09-03",
    totalTabsOpened: 12,
    totalTabsClosed: 9,
    peakTabCount: 34,
    domainTime: { "github.com": 1000 },
    distractionDomains: [],
    tabDebtScore: 52,
  };

  it("maps a day with activity into the prompt input shape", () => {
    expect(debriefInputFromDay(day, ["github.com", "youtube.com"])).toEqual({
      date: "2026-09-03",
      domains: ["github.com", "youtube.com"],
      opened: 12,
      closed: 9,
      peak: 34,
      debt: 52,
    });
  });

  it("returns null when there is no recorded activity", () => {
    const empty: DailyAnalytics = {
      date: "2026-09-03",
      totalTabsOpened: 0,
      totalTabsClosed: 0,
      peakTabCount: 0,
      domainTime: {},
      distractionDomains: [],
      tabDebtScore: 0,
    };
    expect(debriefInputFromDay(empty, [])).toBeNull();
    expect(debriefInputFromDay(null, [])).toBeNull();
  });

  it("still produces an input when only domains were visited", () => {
    const onlyDomains: DailyAnalytics = {
      date: "2026-09-03",
      totalTabsOpened: 0,
      totalTabsClosed: 0,
      peakTabCount: 0,
      domainTime: { "news.ycombinator.com": 500 },
      distractionDomains: [],
      tabDebtScore: 0,
    };
    expect(debriefInputFromDay(onlyDomains, ["news.ycombinator.com"])).not.toBeNull();
  });
});

describe("coachDaysFromAnalytics", () => {
  const day = (date: string): DailyAnalytics => ({
    date,
    totalTabsOpened: 5,
    totalTabsClosed: 2,
    peakTabCount: 10,
    domainTime: { "github.com": 3000, "youtube.com": 1000, "x.com": 500, "other.com": 50 },
    distractionDomains: [],
    tabDebtScore: 30,
  });

  it("builds a 30-day window ending today, most recent last", () => {
    const now = new Date("2026-09-03T12:00:00Z");
    const days = coachDaysFromAnalytics([day("2026-09-03")], now);
    expect(days).toHaveLength(30);
    expect(days[29].date).toBe("2026-09-03");
    expect(days[28].date).toBe("2026-09-02");
    expect(days[0].date).toBe("2026-08-05");
  });

  it("caps domains at the top 3", () => {
    const now = new Date("2026-09-03T12:00:00Z");
    const days = coachDaysFromAnalytics([day("2026-09-03")], now);
    expect(days[29].domains).toEqual(["github.com", "youtube.com", "x.com"]);
  });

  it("zeroes missing days", () => {
    const now = new Date("2026-09-03T12:00:00Z");
    const days = coachDaysFromAnalytics([], now);
    expect(days[29]).toEqual({ date: "2026-09-03", domains: [], opened: 0, closed: 0, debt: 0 });
  });

  it("hasCoachData is false only for a fully empty window", () => {
    const now = new Date("2026-09-03T12:00:00Z");
    expect(hasCoachData(coachDaysFromAnalytics([], now))).toBe(false);
    expect(hasCoachData(coachDaysFromAnalytics([day("2026-09-03")], now))).toBe(true);
  });
});

describe("generateDebrief / generateCoach", () => {
  function stubGenerate(ok: boolean, body: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok,
        status: ok ? 200 : 500,
        text: async () => body,
      })),
    );
  }

  it("generateDebrief returns a parsed report from the transport", async () => {
    stubGenerate(true, JSON.stringify({ response: '{"summary":"good day","sections":[]}' }));
    await expect(
      generateDebrief(
        { date: "2026-09-03", domains: ["github.com"], opened: 5, closed: 2, peak: 9, debt: 30 },
        "qwen2.5:7b",
      ),
    ).resolves.toEqual({ summary: "good day", sections: [] });
  });

  it("generateDebrief throws when the output is unparseable", async () => {
    stubGenerate(true, JSON.stringify({ response: "sorry, no json" }));
    await expect(
      generateDebrief(
        { date: "2026-09-03", domains: [], opened: 1, closed: 0, peak: 1, debt: 0 },
        "qwen2.5:7b",
      ),
    ).rejects.toThrow("Debrief output");
  });

  it("generateCoach returns a parsed report", async () => {
    stubGenerate(true, JSON.stringify({ response: '{"insights":[{"text":"ok","severity":"notice"}]}' }));
    await expect(generateCoach([], "qwen2.5:7b")).resolves.toEqual({
      insights: [{ text: "ok", severity: "notice" }],
    });
  });

  it("generateCoach throws on transport failure", async () => {
    stubGenerate(false, "boom");
    await expect(generateCoach([], "qwen2.5:7b")).rejects.toThrow("Ollama 500");
  });
});

describe("AI_REPORTS_KEY", () => {
  it("is the documented storage key", () => {
    expect(AI_REPORTS_KEY).toBe("aiReports");
  });
});