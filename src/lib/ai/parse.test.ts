import { describe, it, expect } from "vitest";
import {
  extractJson,
  extractField,
  parseNumericIds,
  parseList,
  coerceNumber,
  coerceString,
  coerceStringArray,
} from "./parse";

describe("extractJson", () => {
  it("parses clean JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("strips markdown code fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('```\n[1]\n```')).toEqual([1]);
  });

  it("recovers JSON embedded in prose", () => {
    expect(extractJson('Sure! Here you go: {"keep":[1,2]} — hope that helps')).toEqual({
      keep: [1, 2],
    });
    expect(extractJson('Result: {"items":[{"a":1}]} (done)')).toEqual({
      items: [{ a: 1 }],
    });
  });

  it("recovers a bare array wrapped in prose", () => {
    expect(extractJson("the ids are [7, 8] for this")).toEqual([7, 8]);
  });

  it("recovers a real object past an earlier unparseable bracket", () => {
    expect(extractJson('Note [abc]: {"keep":[1,2]}')).toEqual({ keep: [1, 2] });
    expect(extractJson('junk { unbalanced then [1,2]')).toEqual([1, 2]);
  });

  it("handles braces and escaped quotes inside strings", () => {
    expect(extractJson('{"a":"}"}')).toEqual({ a: "}" });
    expect(extractJson('{"a":"with \\"quotes\\" inside"}')).toEqual({
      a: 'with "quotes" inside',
    });
  });

  it("ignores prose that merely mentions braces out of order", () => {
    expect(extractJson("no json here, just a } and { somewhere")).toBeNull();
  });

  it("returns null on garbage and empty input", () => {
    expect(extractJson("")).toBeNull();
    expect(extractJson("totally not json")).toBeNull();
    expect(extractJson("not json at all :(")).toBeNull();
  });
});

describe("extractField", () => {
  it("extracts a top-level field from clean JSON", () => {
    expect(extractField('{"summary":"five lines","sections":[]}', "summary")).toBe(
      "five lines",
    );
  });

  it("extracts a field from prose-wrapped JSON", () => {
    expect(extractField('Here: {"summary":"ok"}', "summary")).toBe("ok");
  });

  it("falls back to inline key lookup in truncated prose", () => {
    expect(extractField('output truncated: {"summary": "short and sweet"', "summary")).toBe(
      "short and sweet",
    );
    expect(extractField("the summary: \"short and sweet\" ok", "summary")).toBe(
      "short and sweet",
    );
  });

  it("returns undefined when the key is absent", () => {
    expect(extractField('{"other":1}', "summary")).toBeUndefined();
  });

  it("does not return a raw string for a truncated non-string value", () => {
    expect(extractField('sections: [1,[2]]', "sections")).toBeNull();
  });
});

describe("parseNumericIds", () => {
  const valid = [1, 2, 3];
  it("parses {ids:[...]} and bare arrays", () => {
    expect(parseNumericIds('{"ids":[1,3]}', valid)).toEqual([1, 3]);
    expect(parseNumericIds("[2,3]", valid)).toEqual([2, 3]);
  });
  it("drops invalid ids and dedupes", () => {
    expect(parseNumericIds('{"ids":[1,99,1]}', valid)).toEqual([1]);
  });
  it("falls back to digit extraction", () => {
    expect(parseNumericIds("tabs 2 and 3 look relevant", valid)).toEqual([2, 3]);
  });
  it("returns [] on garbage", () => {
    expect(parseNumericIds("no numbers", valid)).toEqual([]);
  });
});

describe("parseList", () => {
  it("parses {items:[...]} through the item validator", () => {
    const out = parseList<{ id: number }>(
      '{"items":[{"tabId":1,"action":"close"},{"tabId":2,"action":"keep"},{"tabId":"bad","action":"keep"}]}',
      (raw) => {
        if (!raw || typeof raw !== "object") return null;
        const id = coerceNumber((raw as { tabId?: unknown }).tabId);
        if (id === null) return null;
        return { id };
      },
    );
    expect(out).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("parses a bare array", () => {
    expect(
      parseList("[1,2,3]", (raw) => coerceNumber(raw)),
    ).toEqual([1, 2, 3]);
  });

  it("returns [] when no array is present", () => {
    expect(parseList('{"summary":"x"}', () => 1)).toEqual([]);
    expect(parseList("garbage", () => 1)).toEqual([]);
  });
});

describe("coercers", () => {
  it("coerceNumber handles numbers, numeric strings, rejects others", () => {
    expect(coerceNumber(7)).toBe(7);
    expect(coerceNumber("7")).toBe(7);
    expect(coerceNumber(" 8 ")).toBe(8);
    expect(coerceNumber("nope")).toBeNull();
    expect(coerceNumber(null)).toBeNull();
  });

  it("coerceNumber rejects empty/whitespace strings (Number('') is 0)", () => {
    expect(coerceNumber("")).toBeNull();
    expect(coerceNumber("   ")).toBeNull();
  });

  it("coerceString trims and rejects empty", () => {
    expect(coerceString("  hello  ")).toBe("hello");
    expect(coerceString("   ")).toBeNull();
    expect(coerceString(12)).toBeNull();
  });

  it("coerceStringArray filters non-strings", () => {
    expect(coerceStringArray(["a", 1, "b"])).toEqual(["a", "b"]);
    expect(coerceStringArray("not-array")).toBeNull();
  });
});