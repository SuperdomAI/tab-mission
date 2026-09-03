import { describe, it, expect } from "vitest";
import {
  cleanAssistantText,
  compactMessages,
  estimateTokens,
  stripCodeFences,
  COMPACTION_NOTE,
} from "./chatText";

describe("stripCodeFences", () => {
  it("removes fenced code blocks", () => {
    expect(
      stripCodeFences('I\'ll use the tool.\n```\ncloseTab(Inbox)\n```\nDone.'),
    ).toBe("I'll use the tool.\n\nDone.");
  });

  it("removes fenced blocks with a language tag", () => {
    expect(
      stripCodeFences('```bash\ncloseTab "Inbox"\n```\nClosed it.'),
    ).toBe("\nClosed it.");
  });

  it("unwraps inline backticks", () => {
    expect(stripCodeFences("call `closeTab` with `Inbox`")).toBe(
      "call closeTab with Inbox",
    );
  });

  it("leaves plain text untouched", () => {
    expect(stripCodeFences("Closed the Inbox tab.")).toBe("Closed the Inbox tab.");
  });
});

describe("cleanAssistantText", () => {
  it("strips fences, collapses blank lines, and trims", () => {
    expect(
      cleanAssistantText(
        "\nI'll use the tool.\n```closeTab(Inbox)```\n\n\n\nClosed it.\n",
      ),
    ).toBe("I'll use the tool.\n\nClosed it.");
  });
});

describe("compactMessages", () => {
  const msg = (role: "user" | "assistant", content: string) => ({ role, content });
  const big = "x".repeat(8000); // ~2000 tokens

  it("leaves a small transcript untouched", () => {
    const m = [msg("user", "hi"), msg("assistant", "hello")];
    expect(compactMessages(m, 3000)).toEqual({ messages: m, trimmed: 0 });
  });

  it("drops the oldest turns until it fits, prepending the note", () => {
    const m = [
      msg("user", "first"),
      msg("assistant", big),
      msg("user", "second"),
      msg("assistant", big),
      msg("user", "third"),
    ];
    const { messages, trimmed } = compactMessages(m, 3000);
    expect(trimmed).toBeGreaterThan(0);
    expect(messages[0]).toEqual({ role: "system", content: COMPACTION_NOTE });
    expect(messages.at(-1)).toEqual(m[m.length - 1]); // newest question survives
    // the trimmed transcript fits the budget
    const size = (msgs: { content: string }[]) =>
      msgs.reduce((n, x) => n + estimateTokens(x.content), 0);
    expect(size(messages)).toBeLessThanOrEqual(3000);
  });

  it("never empties the transcript, even for one huge message", () => {
    const m = [msg("user", "x".repeat(20000))];
    const { messages, trimmed } = compactMessages(m, 3000);
    expect(trimmed).toBe(0); // nothing to drop — the loop requires length > 1
    expect(messages).toEqual(m);
  });

  it("handles an empty transcript", () => {
    expect(compactMessages([], 3000)).toEqual({ messages: [], trimmed: 0 });
  });
});