import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { useTabStore } from "../../store/tabStore";
import Overlay from "./Overlay";
import Favicon from "./Favicon";
import { useTabActions } from "../hooks/useTabActions";
import {
  buildTabFuse,
  searchTabs,
  filterCommands,
  type PaletteCommand,
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

  const fuse = useMemo(() => buildTabFuse(tabs), [tabs]);
  const tabResults = useMemo(() => searchTabs(fuse, query), [fuse, query]);

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
              {tabResults.map((t) => (
                <Command.Item
                  key={t.id}
                  value={`tab-${t.id}`}
                  onSelect={() => {
                    jumpTo(t);
                    setOpen(false);
                  }}
                >
                  <Favicon tab={t} size={16} rounded={4} />
                  <span className="truncate">{t.title || t.url}</span>
                  <span className="ml-auto font-mono text-[10px] text-faint shrink-0">{t.domain}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </Overlay>
  );
}
