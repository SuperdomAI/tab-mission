import { useTransition } from 'react';
import { useTabStore } from '../../store/tabStore';
import type { SavedSession } from '../../types/index';

export function useSession() {
  const sessions = useTabStore((s) => s.sessions);
  const tabs = useTabStore((s) => s.tabs);
  const setSessions = useTabStore((s) => s.setSessions);
  const [isPending, startTransition] = useTransition();

  async function saveSession(name: string) {
    try {
      const result = await chrome.storage.local.get('sessions');
      const existing: SavedSession[] = result.sessions || [];
      const newSession: SavedSession = {
        id: `session-${Date.now()}`,
        name,
        savedAt: Date.now(),
        tabs: tabs.map((t) => ({
          title: t.title,
          url: t.url,
          favIconUrl: t.favIconUrl,
        })),
      };
      const updated = [...existing, newSession];
      await chrome.storage.local.set({ sessions: updated });
      startTransition(() => setSessions(updated));
    } catch (e) {
      console.error('[TMC] saveSession error:', e);
    }
  }

  async function restoreSession(sessionId: string) {
    try {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) return;
      const urls = session.tabs.map((t) => t.url).filter(Boolean);
      if (urls.length === 0) return;
      await chrome.windows.create({ url: urls });
    } catch (e) {
      console.error('[TMC] restoreSession error:', e);
    }
  }

  async function deleteSession(sessionId: string) {
    try {
      const result = await chrome.storage.local.get('sessions');
      const existing: SavedSession[] = result.sessions || [];
      const updated = existing.filter((s) => s.id !== sessionId);
      await chrome.storage.local.set({ sessions: updated });
      startTransition(() => setSessions(updated));
    } catch (e) {
      console.error('[TMC] deleteSession error:', e);
    }
  }

  return { sessions, saveSession, restoreSession, deleteSession, isPending };
}
