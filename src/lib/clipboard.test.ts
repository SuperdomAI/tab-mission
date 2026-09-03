import { describe, it, expect } from "vitest";
import { clipboardText } from "./clipboard";

describe("clipboardText", () => {
  it("renders one Title — URL line per tab", () => {
    expect(
      clipboardText([
        { title: "Inbox", url: "https://mail.google.com/" },
        { title: "Video", url: "https://youtube.com/" },
      ]),
    ).toBe("Inbox — https://mail.google.com/\nVideo — https://youtube.com/");
  });

  it("handles an empty list", () => {
    expect(clipboardText([])).toBe("");
  });
});