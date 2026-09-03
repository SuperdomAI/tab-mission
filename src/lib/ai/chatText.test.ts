import { describe, it, expect } from "vitest";
import { cleanAssistantText, stripCodeFences } from "./chatText";

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