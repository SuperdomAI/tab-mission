import { describe, it, expect, vi } from "vitest";
import {
  PAGE_READING_ORIGINS,
  PAGE_READING_PERMISSIONS,
  hasPageReadingPermission,
  requestPageReadingPermission,
  revokePageReadingPermission,
} from "./pageReading";

function chromeMock() {
  return (globalThis as unknown as { chrome: typeof chrome }).chrome;
}

/** The mock's permission fns, cast to vi.fn (the real API typings hide mocks). */
function permFns() {
  return chromeMock().permissions as unknown as {
    contains: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
}

describe("page-reading permission helpers", () => {
  it("requests scripting + <all_urls> origins when not already held", async () => {
    const perms = permFns();
    perms.contains.mockResolvedValueOnce(false); // not held yet
    expect(await requestPageReadingPermission()).toBe(true);
    expect(perms.request).toHaveBeenCalledWith({
      permissions: ["scripting"],
      origins: ["http://*/*", "https://*/*"],
    });
    expect(PAGE_READING_PERMISSIONS).toEqual(["scripting"]);
    expect(PAGE_READING_ORIGINS).toEqual(["http://*/*", "https://*/*"]);
  });

  it("skips the request when the grants are already held", async () => {
    expect(await requestPageReadingPermission()).toBe(true);
    expect(permFns().request).not.toHaveBeenCalled();
  });

  it("resolves false when the user denies the request", async () => {
    permFns().contains.mockResolvedValueOnce(false); // not held → request
    permFns().request.mockResolvedValueOnce(false);
    expect(await requestPageReadingPermission()).toBe(false);
  });

  it("revokes the grants", async () => {
    expect(await revokePageReadingPermission()).toBe(true);
    expect(permFns().remove).toHaveBeenCalledWith({
      permissions: ["scripting"],
      origins: ["http://*/*", "https://*/*"],
    });
  });

  it("checks current grants via contains", async () => {
    permFns().contains.mockResolvedValueOnce(false);
    expect(await hasPageReadingPermission()).toBe(false);
  });
});