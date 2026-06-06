import { describe, it, expect } from "vitest";
import { scoreTabs } from "./relevance";
import { makeTab } from "../test/factory";

const tabs = [
  makeTab({ id: 1, title: "Japan travel itinerary", domain: "lonelyplanet.com", url: "https://lonelyplanet.com/japan" }),
  makeTab({ id: 2, title: "Flights to Tokyo", domain: "google.com", url: "https://google.com/flights/tokyo" }),
  makeTab({ id: 3, title: "AWS Console — EC2", domain: "aws.amazon.com", url: "https://aws.amazon.com/ec2" }),
  makeTab({ id: 4, title: "Jira board — sprint 12", domain: "atlassian.net", url: "https://x.atlassian.net" }),
];

describe("scoreTabs", () => {
  it("keeps goal-relevant tabs and sets aside the rest", () => {
    const { keep, stash } = scoreTabs(tabs, "japan trip tokyo", 0.5);
    const keepIds = keep.map((t) => t.id).sort();
    expect(keepIds).toContain(1);
    expect(keepIds).toContain(2);
    expect(stash.map((t) => t.id).sort()).toEqual([3, 4]);
  });

  it("empty goal keeps everything", () => {
    const { keep, stash } = scoreTabs(tabs, "  ");
    expect(keep).toHaveLength(4);
    expect(stash).toHaveLength(0);
  });

  it("never sets aside pinned tabs", () => {
    const withPinned = [...tabs, makeTab({ id: 5, title: "AWS billing", isPinned: true, domain: "aws.amazon.com" })];
    const { keep, stash } = scoreTabs(withPinned, "japan trip", 0.9);
    expect(keep.map((t) => t.id)).toContain(5); // pinned kept despite irrelevance
    expect(stash.map((t) => t.id)).not.toContain(5);
  });

  it("higher strictness keeps fewer tabs", () => {
    const loose = scoreTabs(tabs, "tokyo", 0.1).keep.length;
    const strict = scoreTabs(tabs, "tokyo", 0.9).keep.length;
    expect(strict).toBeLessThanOrEqual(loose);
  });
});
