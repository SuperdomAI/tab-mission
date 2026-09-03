import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";
import { installChromeMock } from "./chrome-mock";

// Fresh chrome mock before every test so call-count assertions don't leak.
beforeEach(() => {
  installChromeMock();
  // Fresh clipboard stub (the Ask AI copyTabUrls tool writes via this).
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});
