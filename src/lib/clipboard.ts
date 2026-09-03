/**
 * Ask AI `copyTabUrls` tool — optional `clipboardWrite` grant (F6-style:
 * requested at the user's explicit opt-in in Settings, revocable). The write
 * happens after a streaming model turn, so it can't ride a user gesture —
 * the permission is required for `navigator.clipboard.writeText` to work
 * from an extension page.
 */

export const CLIPBOARD_PERMISSION = ["clipboardWrite"] as const;

function chromePermissions() {
  return (globalThis as { chrome?: typeof chrome }).chrome?.permissions;
}

/** True when the `clipboardWrite` grant is currently held. */
export async function hasClipboardPermission(): Promise<boolean> {
  const perms = chromePermissions();
  if (!perms) return true; // non-extension context (tests)
  return perms.contains({ permissions: [...CLIPBOARD_PERMISSION] });
}

/** Request the grant; resolves false when the user denies. Never throws. */
export async function requestClipboardPermission(): Promise<boolean> {
  try {
    const perms = chromePermissions();
    if (!perms) return true;
    if (await hasClipboardPermission()) return true;
    return perms.request({ permissions: [...CLIPBOARD_PERMISSION] });
  } catch {
    return false;
  }
}

/** Revoke the grant (optional permissions can be removed). Never throws. */
export async function revokeClipboardPermission(): Promise<boolean> {
  try {
    const perms = chromePermissions();
    if (!perms) return true;
    return perms.remove({ permissions: [...CLIPBOARD_PERMISSION] });
  } catch {
    return false;
  }
}

/** Clipboard payload: one "Title — URL" line per tab. */
export function clipboardText(
  tabs: Pick<{ title: string; url: string }, "title" | "url">[],
): string {
  return tabs.map((t) => `${t.title} — ${t.url}`).join("\n");
}