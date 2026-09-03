/**
 * F6 page-reading grants — `scripting` + `<all_urls>`-style host access,
 * requested ONLY at the user's explicit opt-in ("Read pages for AI" in
 * Settings) and revocable both from chrome://extensions and in-settings
 * (optional permissions can be removed programmatically). Everything else
 * in the extension works without these grants.
 */

export const PAGE_READING_PERMISSIONS = ["scripting"] as const;

export const PAGE_READING_ORIGINS = ["http://*/*", "https://*/*"] as const;

function chromePermissions() {
  return (globalThis as { chrome?: typeof chrome }).chrome?.permissions;
}

/** True when the page-reading grants are currently held. */
export async function hasPageReadingPermission(): Promise<boolean> {
  const perms = chromePermissions();
  if (!perms) return true; // non-extension context (tests)
  return perms.contains({
    permissions: [...PAGE_READING_PERMISSIONS],
    origins: [...PAGE_READING_ORIGINS],
  });
}

/** Request the grants; resolves false when the user denies. Never throws. */
export async function requestPageReadingPermission(): Promise<boolean> {
  try {
    const perms = chromePermissions();
    if (!perms) return true;
    if (await hasPageReadingPermission()) return true;
    return perms.request({
      permissions: [...PAGE_READING_PERMISSIONS],
      origins: [...PAGE_READING_ORIGINS],
    });
  } catch {
    return false;
  }
}

/** Revoke the grants (optional permissions can be removed). Never throws. */
export async function revokePageReadingPermission(): Promise<boolean> {
  try {
    const perms = chromePermissions();
    if (!perms) return true;
    return perms.remove({
      permissions: [...PAGE_READING_PERMISSIONS],
      origins: [...PAGE_READING_ORIGINS],
    });
  } catch {
    return false;
  }
}