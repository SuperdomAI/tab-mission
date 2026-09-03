import { describe, it, expect } from "vitest";
import { extractPageText, truncatePageText, PAGE_TEXT_CAP } from "./pageExtract";

describe("truncatePageText", () => {
  it("returns short text unchanged", () => {
    expect(truncatePageText("hello world")).toBe("hello world");
  });

  it("truncates at the prompt cap on a word boundary", () => {
    const text = "word ".repeat(2000).trim();
    const out = truncatePageText(text);
    expect(out.length).toBeLessThanOrEqual(PAGE_TEXT_CAP);
    expect(out.length).toBeGreaterThan(PAGE_TEXT_CAP - 10); // kept the budget
    expect(out.endsWith("word")).toBe(true); // no mid-word cut
  });

  it("cuts mid-word only when the last space is unreasonably early", () => {
    const text = "a".repeat(PAGE_TEXT_CAP) + " bcdefghijklmnop";
    const out = truncatePageText(text);
    expect(out.length).toBeLessThanOrEqual(PAGE_TEXT_CAP);
  });

  it("honors an explicit cap", () => {
    const out = truncatePageText("a b c d e f g h", 5);
    expect(out.length).toBeLessThanOrEqual(5);
  });
});

describe("extractPageText", () => {
  function fakeDoc(bodyText: string) {
    return {
      title: "The Page Title",
      querySelector: () => ({ content: "A meta description." }),
      body: { innerText: bodyText, textContent: bodyText },
    } as unknown as Document;
  }

  it("reads title, meta description, and visible text", () => {
    const page = extractPageText(fakeDoc("Hello visible text"));
    expect(page).toEqual({
      title: "The Page Title",
      metaDescription: "A meta description.",
      text: "Hello visible text",
    });
  });

  it("falls back to textContent and tolerates a missing body", () => {
    const doc = {
      title: "T",
      querySelector: () => null,
      body: { innerText: "", textContent: "from textContent" },
    } as unknown as Document;
    expect(extractPageText(doc).text).toBe("from textContent");
    expect(extractPageText({ title: "T", querySelector: () => null, body: null } as unknown as Document).text).toBe("");
  });
});