import { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { useTabStore } from "../../store/tabStore";
import { useTabActions } from "../hooks/useTabActions";
import {
  ensureOllamaPermission,
  streamChat,
  type ChatMessageFull,
  type ToolCall,
} from "../../lib/ollama";
import {
  CLOSE_TAB_TOOL,
  CLOSE_OTHERS_TOOL,
  COPY_TABS_TOOL,
  DUPLICATE_TAB_TOOL,
  GROUP_TABS_TOOL,
  HIBERNATE_TAB_TOOL,
  JUMP_TAB_TOOL,
  MUTE_TAB_TOOL,
  OPEN_TAB_TOOL,
  PIN_TAB_TOOL,
  READ_PAGE_TOOL,
  REOPEN_TAB_TOOL,
  SAVE_SESSION_TOOL,
  UNMUTE_TAB_TOOL,
  UNPIN_TAB_TOOL,
  closeOthersResultText,
  closeResultText,
  copyResultText,
  detectCloseProposals,
  detectHibernateProposals,
  groupResultText,
  jumpResultText,
  openResultText,
  readPageRefusalText,
  readPageSuccessText,
  resolveCloseOthersTarget,
  resolveCloseTarget,
  resolveCopyTitles,
  resolveGroupTarget,
  resolveOpenUrl,
  resolveTabTarget,
  saveSessionResultText,
  type CloseProposal,
  type CloseTarget,
} from "../../lib/ai/chatTools";
import { cleanAssistantText, compactMessages } from "../../lib/ai/chatText";
import Tooltip from "./Tooltip";
import { persistSession } from "../hooks/useTabActions";
import { hasPageReadingPermission } from "../../lib/pageReading";
import { hasReopenPermission, resolveReopenTarget } from "../../lib/ai/reopen";
import { hasClipboardPermission, clipboardText } from "../../lib/clipboard";
import { extractPageText } from "../../lib/pageExtract";
import type { EnrichedTab } from "../../types/index";

interface AskAIProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  /** Fired when a chat tool call actually closes a tab (undo toast in App). */
  onClosed: (tab: Pick<EnrichedTab, "title" | "url">) => void;
}

const SUGGESTIONS = [
  "Which tabs can I safely close?",
  "Summarize what's open right now",
  "Spot any duplicate tabs",
  "Which tabs haven't I touched in a while?",
  "Help me focus — what should I keep?",
  "Any tabs I can hibernate to save memory?",
  "Group my open work into projects",
  "What are you able to help with?",
  "Mute the tab that's playing audio",
  "Close every tab except the one I'm using",
  "Duplicate a tab I mention",
  "Reopen the last tab I closed",
  "Copy the links of my open tabs",
  "Save all my open tabs as a session",
  "Tell me what's on one of my tabs",
  "Jump straight to a tab I have open",
];

const MAX_TOOL_TURNS = 2;
const TAB_LIST_CAP = 40;

/** The full agentic toolset — sent with every request, and the allow-list for tool execution. */
const TOOL_DEFS = [
  CLOSE_TAB_TOOL,
  HIBERNATE_TAB_TOOL,
  OPEN_TAB_TOOL,
  JUMP_TAB_TOOL,
  GROUP_TABS_TOOL,
  SAVE_SESSION_TOOL,
  PIN_TAB_TOOL,
  UNPIN_TAB_TOOL,
  READ_PAGE_TOOL,
  MUTE_TAB_TOOL,
  UNMUTE_TAB_TOOL,
  CLOSE_OTHERS_TOOL,
  DUPLICATE_TAB_TOOL,
  REOPEN_TAB_TOOL,
  COPY_TABS_TOOL,
];

/**
 * Ask AI — a right-side chat sidebar (docs-site style) over the open tab
 * list, streaming from local Ollama through the SW proxy port. The model can
 * propose `closeTab` / `hibernateTab` calls; the UI validates every call
 * against the live tab store and executes it via `useTabActions` ("AI
 * proposes, UI executes").
 * Tabs are identified by exact title (never ids). Pinned tabs are never
 * closable or hibernable. Degrades to a text-only chat when the model/Ollama
 * has no tool support (single retry without tools).
 */
export default function AskAI({ open, onClose, onOpenSettings, onClosed }: AskAIProps) {
  const tabs = useTabStore((s) => s.tabs);
  const settings = useTabStore((s) => s.settings);
  const { closeMany, hibernateMany, jumpTo } = useTabActions();

  const [messages, setMessages] = useState<ChatMessageFull[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [pendingText, setPendingText] = useState("");
  const [toolsOff, setToolsOff] = useState(false);
  const [proposals, setProposals] = useState<CloseProposal[]>([]);
  const [hibernateProposals, setHibernateProposals] = useState<CloseProposal[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const chatResetRef = useRef(false);
  const ctrlRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestBtnRef = useRef<HTMLButtonElement>(null);
  const suggestPopRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSuggestTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = closeTimer.current = null;
  }, []);

  const openSuggestions = useCallback(() => {
    clearSuggestTimers();
    setSuggestionsOpen(true);
  }, [clearSuggestTimers]);

  /** Hover opens after a short grace so passing the mouse doesn't flash it. */
  const scheduleOpen = useCallback(() => {
    clearSuggestTimers();
    openTimer.current = setTimeout(openSuggestions, 150);
  }, [clearSuggestTimers, openSuggestions]);

  const scheduleClose = useCallback(() => {
    clearSuggestTimers();
    closeTimer.current = setTimeout(() => setSuggestionsOpen(false), 200);
  }, [clearSuggestTimers]);

  // Close when the sidebar closes and clean up timers on unmount.
  useEffect(() => {
    if (!open) setSuggestionsOpen(false);
    return () => clearSuggestTimers();
  }, [open, clearSuggestTimers]);

  // Click anywhere outside the button/menu closes it.
  useEffect(() => {
    if (!suggestionsOpen) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (suggestBtnRef.current?.contains(t) || suggestPopRef.current?.contains(t)) return;
      setSuggestionsOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [suggestionsOpen]);

  // Esc closes the sidebar.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Keep the thread scrolled to the latest message while streaming.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pendingText, streaming]);

const system = useCallback(
    (openTabs: EnrichedTab[]) => {
      const lines = openTabs
        .slice(0, TAB_LIST_CAP)
        .map((t) => `- ${t.title} (${t.domain})${t.isPinned ? " [pinned]" : ""}`)
        .join("\n");
      return {
        role: "system",
        content:
          "You are a friendly, capable assistant living in the user's new tab page. " +
          "You can see their open browser tabs, so you can help tidy them (suggest what to keep or close, " +
          "spot duplicates or forgotten tabs, summarize what's open), and you can also answer everyday " +
          "questions and help with quick tasks. Closing tabs is just one of your abilities — you are a " +
          "general assistant, not a tab-closing tool. Be brief: at most two short sentences per reply. " +
          "No greetings, no farewells, no markdown, no code blocks, and never repeat the list of open tabs " +
          "in your reply. " +
          "When the user asks you to close a tab, you MUST call the closeTab tool with the tab's exact title " +
          "from the list below — replying \"Closed ...\" without calling the tool is a lie, never do it. " +
          "When the user asks you to hibernate, discard, unload, or save memory on a tab, call the " +
          "hibernateTab tool (same exact-title rule) — never closeTab for a hibernate request, the tab must " +
          "stay open. Replying \"Hibernated ...\" without calling hibernateTab is a lie, never do it. " +
          "When the user asks you to open or visit a website, call the openTab tool with a full URL " +
          "(https://...), e.g. openTab { url: \"https://google.com\" } — only http/https URLs open. " +
          "When the user asks to open or focus a tab that is ALREADY open, call jumpTab with its exact title " +
          "(never openTab — that would duplicate it). To group tabs, call groupTabs with an array of exact " +
          "titles. To save all open tabs for later, call saveSession with a short name. To pin or unpin a " +
          "tab, call pinTab or unpinTab with its exact title. When the user asks what's on a page or to " +
          "summarize a specific tab, call readPage with its exact title and answer from the content you receive. " +
          "When the user wants quiet, call muteTab with the exact title (unmuteTab reverses it). When the user " +
          "asks to close everything else or declutter, call closeOtherTabs with the exact title of the tab to " +
          "KEEP — it closes all other non-pinned tabs. To open another copy of a tab, call duplicateTab with its " +
          "exact title. When the user just closed something and wants it back, call reopenClosedTab (no arguments). " +
          "To share or copy links, call copyTabUrls with an array of exact titles, or omit titles to copy all. " +
          "Never invent a tab title: only mention or act on tabs that appear in the list below. " +
          "Use the exact title only, without the domain in parentheses. Do not announce the call or show the " +
          "tool name in your reply. After the tool runs you will receive its result and should reply with one " +
          'short confirmation sentence, e.g. "Closed the Inbox tab."\n' +
          "Example: user: \"close the inbox tab\" → assistant calls closeTab with title \"Inbox\", then confirms.\n" +
          "Example: user: \"hibernate the video tab\" → assistant calls hibernateTab with title \"Video\", then confirms.\n" +
          "Example: user: \"open google\" → assistant calls openTab with url \"https://google.com\", then confirms.\n" +
          `Never close or hibernate a pinned tab. Open tabs:\n${lines}`,
      } as const;
    },
    [],
  );

  const append = useCallback((msg: ChatMessageFull) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  /** New chat — clear the thread (and the model's context window). */
  function newChat() {
    // Arm the abort-swallow ONLY when there is an in-flight stream to abort.
    // Otherwise a later real error (Ollama down, missing model) must still
    // surface — a stale flag would silently eat it.
    chatResetRef.current = ctrlRef.current !== null;
    ctrlRef.current?.abort();
    setMessages([]);
    setDraft("");
    setPendingText("");
    setProposals([]);
    setHibernateProposals([]);
    setToolsOff(false);
  }

  async function send(text: string) {
    if (!text.trim() || streaming) return;
    setDraft("");
    setToolsOff(false);
    setProposals([]);
    setHibernateProposals([]);
    const userMsg: ChatMessageFull = { role: "user", content: text };
    append(userMsg);

    let granted = false;
    try {
      granted = await ensureOllamaPermission();
    } catch {
      granted = false;
    }
    if (!granted) {
      append({
        role: "assistant",
        content: "Permission to reach your local Ollama was denied. Enable it in Settings → Local AI.",
      });
      return;
    }

    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setStreaming(true);
    setPendingText("");
    try {
      let conv: ChatMessageFull[] = [...messages, userMsg];
      // Context compaction: small local windows degrade on long transcripts.
      // Drop the oldest turns once the estimate exceeds the budget, insert a
      // system note, and mirror the trimmed thread in the UI.
      const compacted = compactMessages(conv);
      if (compacted.trimmed > 0) {
        conv = compacted.messages;
        setMessages(compacted.messages);
      }
      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        const toolCalls: ToolCall[] = [];
        let acc = "";
        await streamChat({
          messages: [system(useTabStore.getState().tabs), ...conv],
          model: settings.aiChatModel,
          tools: TOOL_DEFS,
          signal: ctrl.signal,
          onDelta: (d) => {
            acc += d;
            setPendingText(cleanAssistantText(acc));
          },
          onToolCall: (name, args) => {
            const known = TOOL_DEFS.some((t) => t.function.name === name);
            if (known) toolCalls.push({ name, arguments: JSON.stringify(args) });
          },
          onRetry: () => setToolsOff(true),
        });
        if (toolCalls.length === 0) {
          if (acc) append({ role: "assistant", content: cleanAssistantText(acc) });
          // Weak models narrate actions instead of calling the tools — surface
          // any validated close/hibernate-claim as an actionable chip (never
          // auto-close or auto-hibernate from text).
          const live = useTabStore.getState().tabs;
          setProposals(detectCloseProposals(acc, live));
          setHibernateProposals(detectHibernateProposals(acc, live));
          break;
        }
        // Record the assistant's tool-call turn, execute each validated call,
        // then feed the results back so the model confirms what it did.
        const toolMsg: ChatMessageFull = {
          role: "assistant",
          content: cleanAssistantText(acc),
          tool_calls: toolCalls,
        };
        const results = await executeToolCalls(toolCalls);
        const resultMsg: ChatMessageFull = { role: "tool", content: results.join("\n") };
        append(toolMsg);
        append(resultMsg);
        conv = [...conv, toolMsg, resultMsg];
        setPendingText("");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (chatResetRef.current) {
        chatResetRef.current = false; // newChat() aborted — the fresh thread stays empty
      } else if (ctrl.signal.aborted) {
        append({ role: "assistant", content: "Stopped." });
      } else {
        const hint = /404/.test(msg)
          ? `Model "${settings.aiChatModel}" not found. Set an installed model in Settings → Local AI.`
          : "Is Ollama running? Start it (Settings → Local AI).";
        append({ role: "assistant", content: `Couldn't reach the model (${msg}). ${hint}` });
      }
    } finally {
      setStreaming(false);
      setPendingText("");
      ctrlRef.current = null;
    }
  }

  async function executeToolCalls(calls: ToolCall[]): Promise<string[]> {
    const live = useTabStore.getState().tabs;
    const results: string[] = [];
    for (const call of calls) {
      let args: unknown = call.arguments;
      try {
        args = JSON.parse(call.arguments);
      } catch {
        args = call.arguments;
      }
      const target = resolveCloseTarget(args, live);
      if (call.name === READ_PAGE_TOOL.function.name) {
        results.push(await executeReadPage(target, call.name));
      } else if (call.name === OPEN_TAB_TOOL.function.name) {
        const open = resolveOpenUrl(args);
        if ("url" in open) {
          void chrome.tabs.create({ url: open.url, active: true });
        }
        results.push(openResultText(open));
      } else if (call.name === HIBERNATE_TAB_TOOL.function.name) {
        // Discard is reversible — no undo toast, no onClosed.
        if ("tabs" in target && target.tabs.length > 0) {
          void hibernateMany(target.tabs);
        }
        results.push(closeResultText(target, call.name, "hibernated"));
      } else if (call.name === JUMP_TAB_TOOL.function.name) {
        if ("tabs" in target && target.tabs.length > 0) {
          void jumpTo(target.tabs[0]); // activates + focuses the window
        }
        results.push(jumpResultText(target));
      } else if (
        call.name === MUTE_TAB_TOOL.function.name ||
        call.name === UNMUTE_TAB_TOOL.function.name
      ) {
        // Reversible audio control — pinned tabs may be muted.
        const muted = call.name === MUTE_TAB_TOOL.function.name;
        const muteTarget = resolveTabTarget(args, live);
        if ("tabs" in muteTarget) {
          for (const t of muteTarget.tabs) {
            void chrome.tabs.update(t.id, { muted });
          }
        }
        results.push(closeResultText(muteTarget, call.name, muted ? "muted" : "unmuted"));
      } else if (call.name === CLOSE_OTHERS_TOOL.function.name) {
        const others = resolveCloseOthersTarget(args, live);
        if ("closedTabs" in others && others.closedTabs.length > 0) {
          void closeMany(others.closedTabs.map((t) => t.id)); // one batched remove
          for (const tab of others.closedTabs) {
            onClosed({ title: tab.title, url: tab.url });
          }
        }
        results.push(closeOthersResultText(others));
      } else if (call.name === DUPLICATE_TAB_TOOL.function.name) {
        const dupTarget = resolveTabTarget(args, live);
        if ("tabs" in dupTarget && dupTarget.tabs.length > 0) {
          void chrome.tabs.duplicate(dupTarget.tabs[0].id);
        }
        results.push(closeResultText(dupTarget, call.name, "duplicated"));
      } else if (call.name === REOPEN_TAB_TOOL.function.name) {
        results.push(await executeReopen());
      } else if (call.name === COPY_TABS_TOOL.function.name) {
        results.push(await executeCopyTabs(args, live));
      } else if (call.name === GROUP_TABS_TOOL.function.name) {
        const group = resolveGroupTarget(args, live);
        if ("tabIds" in group && group.tabIds.length > 0) {
          void chrome.tabs.group({ tabIds: group.tabIds as [number, ...number[]] });
        }
        results.push(groupResultText(group));
      } else if (call.name === SAVE_SESSION_TOOL.function.name) {
        const rawName = (args as Record<string, unknown> | null)?.name;
        const name =
          typeof rawName === "string" && rawName.trim()
            ? rawName.trim()
            : `AI session ${new Date().toLocaleDateString()}`;
        const all = useTabStore.getState().tabs;
        void persistSession(name, all);
        results.push(saveSessionResultText(all.length, name));
      } else if (
        call.name === PIN_TAB_TOOL.function.name ||
        call.name === UNPIN_TAB_TOOL.function.name
      ) {
        const pinned = call.name === PIN_TAB_TOOL.function.name;
        if ("tabs" in target) {
          for (const t of target.tabs) {
            void chrome.tabs.update(t.id, { pinned });
          }
        }
        results.push(closeResultText(target, call.name, pinned ? "pinned" : "unpinned"));
      } else {
        if ("tabs" in target) {
          const ids = target.tabs.map((t) => t.id);
          if (ids.length > 0) void closeMany(ids); // one batched chrome.tabs.remove
          for (const tab of target.tabs) {
            onClosed({ title: tab.title, url: tab.url });
          }
        }
        results.push(closeResultText(target, call.name));
      }
    }
    return results;
  }

  function stop() {
    ctrlRef.current?.abort();
  }

  /**
   * readPage execution — read-only. Gates on the optional page-reading grant
   * (F6's opt-in), extracts the first matching tab's text, and hands the
   * model a truncated transcript. Restricted pages (chrome://) reject in
   * `executeScript` → refusal, nothing happens.
   */
  async function executeReadPage(target: CloseTarget, name: string): Promise<string> {
    if (!("tabs" in target) || target.tabs.length === 0) {
      return closeResultText(target, name, "read");
    }
    const tab = target.tabs[0];
    if (!(await hasPageReadingPermission())) return readPageRefusalText("no-permission");
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageText,
      });
      const page = res?.result as { title?: string; text?: string } | undefined;
      if (!page || !page.text) return readPageRefusalText("unreadable");
      return readPageSuccessText(page.title || tab.title, page.text);
    } catch {
      return readPageRefusalText("unreadable");
    }
  }

  /**
   * reopenClosedTab execution — gates on the optional `sessions` grant
   * (Settings opt-in), reopens the most recent TAB-level close (window
   * closes are skipped — auto-restoring a whole window would surprise).
   */
  async function executeReopen(): Promise<string> {
    if (!(await hasReopenPermission())) {
      return 'reopenClosedTab: reopening closed tabs is off — enable "Reopen Closed Tabs" in Settings';
    }
    try {
      const entries = await chrome.sessions.getRecentlyClosed();
      const target = resolveReopenTarget(entries);
      if ("error" in target) {
        return "reopenClosedTab: nothing recently closed to reopen";
      }
      const { sessionId, title } = target.entry;
      if (!sessionId) return "reopenClosedTab: nothing recently closed to reopen";
      await chrome.sessions.restore(sessionId);
      return `reopenClosedTab: reopened — ${title ?? "recently closed tab"}`;
    } catch {
      return "reopenClosedTab: couldn't reopen — nothing happened";
    }
  }

  /**
   * copyTabUrls execution — gates on the optional `clipboardWrite` grant
   * (Settings opt-in), writes "Title — URL" lines for the resolved tabs.
   */
  async function executeCopyTabs(args: unknown, live: EnrichedTab[]): Promise<string> {
    if (!(await hasClipboardPermission())) {
      return 'copyTabUrls: clipboard access is off — enable "Copy Tab Links" in Settings';
    }
    const target = resolveCopyTitles(args, live);
    if ("error" in target) return copyResultText(target);
    try {
      await navigator.clipboard.writeText(clipboardText(target.tabs));
    } catch {
      return "copyTabUrls: clipboard write failed — nothing copied";
    }
    return copyResultText(target);
  }

  /** User clicked a text-claim chip — validate once more, then execute. */
  function executeProposal(p: CloseProposal) {
    const live = useTabStore.getState().tabs;
    const target = resolveCloseTarget({ title: p.title }, live);
    if (!("tabs" in target) || target.tabs.length === 0) {
      setProposals((prev) => prev.filter((x) => x.title !== p.title));
      return;
    }
    void closeMany(target.tabs.map((t) => t.id));
    for (const tab of target.tabs) {
      onClosed({ title: tab.title, url: tab.url });
    }
    setProposals((prev) => prev.filter((x) => x.title !== p.title));
  }

  /** User clicked a "Hibernate · title" chip — validate once more, execute. */
  function executeHibernateProposal(p: CloseProposal) {
    const live = useTabStore.getState().tabs;
    const target = resolveCloseTarget({ title: p.title }, live);
    if (!("tabs" in target) || target.tabs.length === 0) {
      setHibernateProposals((prev) => prev.filter((x) => x.title !== p.title));
      return;
    }
    void hibernateMany(target.tabs);
    setHibernateProposals((prev) => prev.filter((x) => x.title !== p.title));
  }

  const aiOff = !settings.ollamaEnabled;

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      <aside
        aria-label="Ask AI"
        className={`drawer-panel fixed top-0 right-0 h-full w-[380px] max-w-[92vw] z-50 bg-popover border-l border-hairline shadow-2xl flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="label-mono">Ask AI</span>
            {streaming && (
              <span className="font-mono text-[10px] tracking-[0.09em] uppercase text-accent animate-pulse">
                thinking
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline font-mono text-[10px] text-faint truncate max-w-[120px]">
              {settings.aiChatModel}
            </span>
            <Tooltip text="New chat — clears the conversation and the model's context">
              <button
                onClick={newChat}
                aria-label="New chat"
                className="w-7 h-7 grid place-items-center rounded-[7px] text-faint hover:text-ink border border-border"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 12a9 9 0 1 0 2.64-6.36" />
                  <polyline points="3 3 3 9 9 9" />
                </svg>
              </button>
            </Tooltip>
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-7 h-7 grid place-items-center rounded-[7px] text-faint hover:text-ink border border-border"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Thread */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-5 space-y-3">
          {aiOff ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 px-4">
              <p className="text-[13px] text-muted">Local AI is off.</p>
              <p className="text-[12px] text-faint leading-relaxed">
                Ask AI runs entirely on your machine through Ollama — no cloud,
                no API keys. Nothing is sent anywhere.
              </p>
              <button
                onClick={onOpenSettings}
                className="mt-1 text-[12px] text-white bg-accent border border-accent rounded-[9px] px-4 py-2 hover:brightness-110 transition-all"
              >
                Enable in Settings
              </button>
            </div>
          ) : (
            <>
              {messages.length === 0 && (
                <p className="text-[13px] text-faint">
                  Ask about your open tabs, or let me close, hibernate, or open sites for you.
                </p>
              )}

              {messages.map((m, i) => (
                <MessageBubble key={i} msg={m} />
              ))}

              {(streaming || pendingText) && (
                <div className="text-[13px] leading-relaxed whitespace-pre-wrap rounded-[10px] px-3.5 py-2.5 bg-white/[0.04] text-muted mr-8">
                  {pendingText || "Thinking…"}
                </div>
              )}

              {toolsOff && (
                <p className="font-mono text-[10px] text-faint">
                  tool calling unavailable for this model — I can only advise.
                </p>
              )}

              {proposals.length > 0 && (
                <div className="space-y-2">
                  <p className="label-mono">Suggested closes</p>
                  {proposals.map((p) => (
                    <div
                      key={p.title}
                      className="flex items-center gap-2 mr-8 bg-white/[0.03] border border-hairline rounded-[8px] px-2.5 py-2"
                    >
                      <button
                        onClick={() => executeProposal(p)}
                        className="flex-1 text-left font-mono text-[11px] text-ink truncate hover:text-accent transition-colors"
                      >
                        Close · {p.title}
                      </button>
                      <button
                        onClick={() =>
                          setProposals((prev) => prev.filter((x) => x.title !== p.title))
                        }
                        aria-label={`Dismiss ${p.title}`}
                        className="text-faint hover:text-ink transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {hibernateProposals.length > 0 && (
                <div className="space-y-2">
                  <p className="label-mono">Suggested hibernations</p>
                  {hibernateProposals.map((p) => (
                    <div
                      key={p.title}
                      className="flex items-center gap-2 mr-8 bg-white/[0.03] border border-hairline rounded-[8px] px-2.5 py-2"
                    >
                      <button
                        onClick={() => executeHibernateProposal(p)}
                        className="flex-1 text-left font-mono text-[11px] text-ink truncate hover:text-accent transition-colors"
                      >
                        Hibernate · {p.title}
                      </button>
                      <button
                        onClick={() =>
                          setHibernateProposals((prev) => prev.filter((x) => x.title !== p.title))
                        }
                        aria-label={`Dismiss ${p.title}`}
                        className="text-faint hover:text-ink transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Input */}
        {!aiOff && (
          <div className="p-4 border-t border-hairline flex gap-2">
            <button
              ref={suggestBtnRef}
              onClick={() =>
                suggestionsOpen ? setSuggestionsOpen(false) : openSuggestions()
              }
              onMouseEnter={scheduleOpen}
              onMouseLeave={scheduleClose}
              aria-label="Ask a suggested question"
              aria-expanded={suggestionsOpen}
              className={`w-8 h-8 shrink-0 grid place-items-center rounded-[9px] font-mono text-[13px] border transition-colors ${
                suggestionsOpen
                  ? "text-ink border-accent/50 bg-white/[0.06]"
                  : "text-faint hover:text-ink border-border hover:bg-white/[0.04]"
              }`}
            >
              ?
            </button>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(draft)}
              placeholder="Ask about your tabs…"
              className="flex-1 bg-white/[0.04] border border-border rounded-[10px] px-3.5 py-2.5 text-[14px] text-ink outline-none placeholder:text-faint focus:border-accent/50 transition-colors"
            />
            {streaming ? (
              <button
                onClick={stop}
                className="text-[12px] text-muted border border-border rounded-[10px] px-4 hover:text-ink transition-colors"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={() => send(draft)}
                disabled={!draft.trim()}
                className="text-[13px] text-white bg-accent border border-accent rounded-[10px] px-4 disabled:opacity-40 hover:brightness-110 transition-all"
              >
                Send
              </button>
            )}
          </div>
        )}

        {suggestionsOpen && suggestBtnRef.current &&
          ReactDOM.createPortal(
            <div
              ref={suggestPopRef}
              onMouseEnter={openSuggestions}
              onMouseLeave={scheduleClose}
              role="menu"
              aria-label="Suggested questions"
              style={suggestPopoverStyle(suggestBtnRef.current.getBoundingClientRect())}
              className="animate-fade-in bg-popover border border-hairline rounded-[14px] shadow-[0_40px_100px_-30px_#000] p-2 w-[280px] max-h-[60vh] overflow-y-auto"
            >
              <p className="label-mono px-2.5 pt-1.5 pb-1">Try asking</p>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  role="menuitem"
                  onClick={() => {
                    setSuggestionsOpen(false);
                    send(s);
                  }}
                  className="block w-full text-left text-[12px] text-muted hover:text-ink hover:bg-white/[0.07] rounded-[8px] px-2.5 py-2 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>,
            document.body,
          )}
      </aside>
    </>
  );
}

/** Position the suggestion menu above the "?" button (below when cramped). */
function suggestPopoverStyle(rect: DOMRect): React.CSSProperties {
  const width = 280;
  const gap = 8;
  const above = rect.top >= 280;
  return {
    position: "fixed",
    zIndex: 99999,
    width,
    left: Math.min(rect.left, window.innerWidth - width - 12),
    top: above ? rect.top - gap : rect.bottom + gap,
    transform: above ? "translateY(-100%)" : undefined,
  };
}

/** One conversation row: user bubble, assistant bubble, or a tool-call card. */
function MessageBubble({ msg }: { msg: ChatMessageFull }) {
  if (msg.role === "system") {
    return (
      <p className="text-center font-mono text-[10px] text-faint leading-relaxed">
        — earlier messages trimmed to fit the context —
      </p>
    );
  }
  if (msg.role === "user") {
    return (
      <div className="text-[13px] leading-relaxed whitespace-pre-wrap rounded-[10px] px-3.5 py-2.5 bg-accent/15 text-ink ml-10">
        {msg.content}
      </div>
    );
  }
  if (msg.role === "assistant") {
    const toolCalls = "tool_calls" in msg && msg.tool_calls ? msg.tool_calls : [];
    return (
      <div className="space-y-2">
        {msg.content && (
          <div className="text-[13px] leading-relaxed whitespace-pre-wrap rounded-[10px] px-3.5 py-2.5 bg-white/[0.04] text-muted mr-8">
            {msg.content}
          </div>
        )}
        {toolCalls.map((call, i) => {
          let human = call.arguments;
          try {
            const parsed = JSON.parse(call.arguments) as { title?: string };
            if (parsed?.title) human = parsed.title;
          } catch {
            /* keep the raw arguments */
          }
          return (
            <div
              key={i}
              className="mr-8 font-mono text-[11px] text-muted bg-white/[0.03] border border-hairline rounded-[8px] px-3 py-2"
            >
              <span className="text-faint uppercase tracking-[0.09em] text-[10px]">
                tool · {call.name}
              </span>
              <div className="mt-1 text-ink/80 truncate">{human}</div>
            </div>
          );
        })}
      </div>
    );
  }
  // role === "tool" — the execution report the model sent back.
  return (
    <div className="mr-8 font-mono text-[11px] text-faint bg-white/[0.03] border border-hairline rounded-[8px] px-3 py-2">
      {msg.content}
    </div>
  );
}