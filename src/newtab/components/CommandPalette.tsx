import { useEffect, useMemo, useRef, useState } from "react";
import { Command } from "cmdk";
import { useTabStore } from "../../store/tabStore";
import Overlay from "./Overlay";
import Favicon from "./Favicon";
import { useTabActions } from "../hooks/useTabActions";
import { useSession } from "../hooks/useSession";
import { useSessionSummaries } from "../hooks/useSessionSummaries";
import { useTabEmbeddings } from "../hooks/useTabEmbeddings";
import { ensureOllamaPermission, embed } from "../../lib/ollama";
import {
  ensureTabEmbeddings,
  searchSemanticTabs,
  QUERY_DEBOUNCE_MS,
  type ScoredMatch,
} from "../../lib/ai/tabEmbeddings";
import {
  buildTabFuse,
  searchTabs,
  searchTabsSemantic,
  buildSessionFuse,
  searchSessions,
  filterCommands,
  type PaletteCommand,
  type TabSearchResult,
} from "../../lib/commandFilter";
import { selectDuplicates, selectUnvisited, selectZombies } from "../../lib/bulkSelectors";

interface CommandPaletteProps {
  onFocus: (goal: string) => void;
  onOpenWorkspaces: () => void;
  onAskAI: () => void;
}

/** The ⌘K focal surface — the single owner of the ⌘K shortcut. */
export default function CommandPalette({ onFocus, onOpenWorkspaces, onAskAI }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const tabs = useTabStore((s) => s.tabs);
  const settings = useTabStore((s) => s.settings);
  const setViewMode = useTabStore((s) => s.setViewMode);
  const { closeMany, hibernateMany, jumpTo } = useTabActions();
  const { restoreSession } = useSession();
  const { summaries } = useSessionSummaries();
  const { cache: embedCache, save: saveEmbeddings } = useTabEmbeddings();

  // F7 semantic search gate: AI master + per-feature toggle. Off → pure Fuse.
  const semanticOn = settings.ollamaEnabled && settings.aiSemanticSearch;
  const embedModel = settings.aiEmbedModel;

  // ⌘K / Ctrl+K toggles the palette — the ONE owner of this shortcut.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Lazy per-tab embeddings while the palette is open: batch-embed only the
  // stale entries (missing, expired, wrong model, title changed), prune
  // closed tabs, save only when the cache actually changed. Any failure
  // falls back to pure Fuse — semantic search never blocks the palette.
  useEffect(() => {
    if (!open || !semanticOn) return;
    let alive = true;
    void ensureTabEmbeddings(tabs, embedModel, embedCache)
      .then(async (next) => {
        if (alive && next !== embedCache) {
          const granted = await ensureOllamaPermission();
          if (granted) await saveEmbeddings(next);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, semanticOn, tabs, embedCache, saveEmbeddings, embedModel]);

  // Query embedding, debounced: on every query change, wait 250 ms of quiet
  // typing, then embed the query and score it against the fresh tab vectors
  // (cosine ≥ COSINE_THRESHOLD). A sequence guard drops stale responses, so
  // an older embed can never overwrite a newer query's results.
  const [semanticHits, setSemanticHits] = useState<ScoredMatch[] | null>(null);
  const querySeq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!open || !semanticOn || !q) {
      setSemanticHits(null);
      return;
    }
    const seq = ++querySeq.current;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const granted = await ensureOllamaPermission();
          if (!granted || querySeq.current !== seq) return;
          const [vec] = await embed([q], embedModel);
          if (querySeq.current !== seq) return;
          setSemanticHits(searchSemanticTabs(vec, embedCache, embedModel));
        } catch {
          if (querySeq.current === seq) setSemanticHits(null);
        }
      })();
    }, QUERY_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [open, semanticOn, query, embedCache, embedModel]);

  const fuse = useMemo(() => buildTabFuse(tabs), [tabs]);
  const tabResults = useMemo<TabSearchResult[]>(() => {
    if (!semanticOn) {
      return searchTabs(fuse, query).map((t) => ({ tab: t, semantic: false }));
    }
    return searchTabsSemantic(tabs, fuse, query, semanticHits ?? [], 8);
  }, [semanticOn, tabs, fuse, query, semanticHits]);

  const sessions = useTabStore((s) => s.sessions);
  const sessionFuse = useMemo(
    () => buildSessionFuse(sessions, summaries),
    [sessions, summaries],
  );
  const sessionResults = useMemo(
    () => searchSessions(sessionFuse, query),
    [sessionFuse, query],
  );

  const commands = useMemo<PaletteCommand[]>(() => {
    const run = (fn: () => void) => () => {
      fn();
      setOpen(false);
    };
    return [
      { id: "view-stacks", label: "Switch to Stacks", hint: "⌘1", keywords: ["view", "decks"], run: run(() => setViewMode("stacks")) },
      { id: "view-timeline", label: "Switch to Timeline", hint: "⌘2", keywords: ["view", "recent"], run: run(() => setViewMode("timeline")) },
      { id: "close-dupes", label: "Close duplicate tabs", keywords: ["dupes"], run: run(() => closeMany(selectDuplicates(tabs).map((t) => t.id))) },
      { id: "close-unvisited", label: "Close unvisited tabs", keywords: ["never"], run: run(() => closeMany(selectUnvisited(tabs).map((t) => t.id))) },
      { id: "close-zombies", label: "Close zombie tabs", keywords: ["stale", "old"], run: run(() => closeMany(selectZombies(tabs, settings).map((t) => t.id))) },
      { id: "hibernate-all", label: "Hibernate background tabs", keywords: ["sleep", "discard"], run: run(() => hibernateMany(tabs)) },
      { id: "workspaces", label: "Open Workspaces", keywords: ["workspace", "focus", "saved"], run: run(() => onOpenWorkspaces()) },
      ...(settings.ollamaEnabled
        ? [{ id: "ask-ai", label: "Ask AI about your tabs", keywords: ["chat", "ollama"], run: run(() => onAskAI()) }]
        : []),
    ];
  }, [tabs, settings, setViewMode, closeMany, hibernateMany, onOpenWorkspaces, onAskAI]);

  const visibleCommands = filterCommands(commands, query);

  return (
    <Overlay open={open} onClose={() => setOpen(false)}>
      <Command
        label="Command Menu"
        shouldFilter={false}
        className="w-[560px] max-w-[92vw] bg-popover border border-border rounded-[14px] overflow-hidden shadow-[0_40px_100px_-30px_#000]"
      >
        <div className="flex items-center gap-3 px-5 border-b border-hairline">
          <span className="text-faint text-[17px]">⌕</span>
          <Command.Input
            value={query}
            onValueChange={setQuery}
            autoFocus
            placeholder="Search tabs, run a command, or switch view…"
            className="flex-1 bg-transparent py-4 outline-none text-[15px] text-ink placeholder:text-faint"
          />
          <kbd>esc</kbd>
        </div>
        <Command.List className="max-h-[50vh] overflow-y-auto pb-2">
          <Command.Empty className="px-5 py-6 text-muted text-sm">No matches.</Command.Empty>

          {query.trim().length > 0 && (
            <Command.Group heading="Focus">
              <Command.Item
                value="__focus"
                onSelect={() => {
                  onFocus(query.trim());
                  setOpen(false);
                }}
              >
                <span>
                  Focus on “{query.trim()}” <span className="text-faint">— set other tabs aside</span>
                </span>
              </Command.Item>
            </Command.Group>
          )}

          {visibleCommands.length > 0 && (
            <Command.Group heading="Commands">
              {visibleCommands.map((c) => (
                <Command.Item key={c.id} value={`cmd-${c.id}`} onSelect={c.run}>
                  <span>{c.label}</span>
                  {c.hint && <span className="ml-auto font-mono text-[11px] text-faint">{c.hint}</span>}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {tabResults.length > 0 && (
            <Command.Group heading="Tabs">
              {tabResults.map(({ tab, semantic }) => (
                <Command.Item
                  key={tab.id}
                  value={`tab-${tab.id}`}
                  onSelect={() => {
                    jumpTo(tab);
                    setOpen(false);
                  }}
                >
                  <Favicon tab={tab} size={16} rounded={4} />
                  {semantic && (
                    <span
                      title="Semantic match"
                      aria-label="Semantic match"
                      className="size-[5px] shrink-0 rounded-full bg-accent"
                    />
                  )}
                  <span className="truncate">{tab.title || tab.url}</span>
                  <span className="ml-auto font-mono text-[10px] text-faint shrink-0">{tab.domain}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {sessionResults.length > 0 && (
            <Command.Group heading="Sessions">
              {sessionResults.map((s) => (
                <Command.Item
                  key={s.id}
                  value={`session-${s.id}`}
                  onSelect={() => {
                    void restoreSession(s.id);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{s.name}</span>
                  {s.summary && (
                    <span className="ml-auto max-w-[240px] truncate text-[11px] text-faint shrink-0">
                      {s.summary}
                    </span>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </Overlay>
  );
}
