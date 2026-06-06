import { describe, it, expect } from "vitest";
import { buildFaviconUrl, faviconUrl, letterFor } from "./faviconUrl";
import { makeTab } from "../test/factory";

describe("buildFaviconUrl", () => {
  it("encodes pageUrl and size onto the base", () => {
    const url = buildFaviconUrl(
      "chrome-extension://abc/_favicon/",
      "https://github.com/x?a=b",
      32,
    );
    expect(url).toContain("pageUrl=https%3A%2F%2Fgithub.com%2Fx%3Fa%3Db");
    expect(url).toContain("size=32");
  });
});

describe("faviconUrl", () => {
  it("uses chrome.runtime.getURL when available (mock installed)", () => {
    const url = faviconUrl("https://example.com", 16);
    expect(url).toContain("chrome-extension://test-ext-id/_favicon/");
    expect(url).toContain("size=16");
  });

  it("returns '' for an empty pageUrl", () => {
    expect(faviconUrl("")).toBe("");
  });
});

describe("letterFor", () => {
  it("uses first alpha of domain, stripping www", () => {
    expect(letterFor(makeTab({ domain: "www.github.com" }))).toBe("G");
  });
  it("falls back to title then '?'", () => {
    expect(letterFor({ domain: "", title: "" })).toBe("?");
    expect(letterFor({ domain: "", title: "figma" })).toBe("F");
  });
});
