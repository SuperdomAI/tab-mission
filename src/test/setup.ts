import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { installChromeMock } from "./chrome-mock";

// Fresh chrome mock before every test so call-count assertions don't leak.
beforeEach(() => {
  installChromeMock();
});
