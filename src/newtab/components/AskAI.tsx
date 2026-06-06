import { useState, useMemo } from "react";
import { useTabStore } from "../../store/tabStore";
import Overlay from "./Overlay";
import { chat, ensureOllamaPermission, type ChatMessage } from "../../lib/ollama";

/** Minimal local chat about your open tabs (Ollama). Optional, never required. */
export default function AskAI({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tabs = useTabStore((s) => s.tabs);
  const settings = useTabStore((s) => s.settings);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const system = useMemo<ChatMessage>(
    () => ({
      role: "system",
      content:
        "You help the user reason about and tidy their open browser tabs. Be concise. The user's open tabs:\n" +
        tabs.map((t) => `- ${t.title} (${t.domain})`).join("\n"),
    }),
    [tabs],
  );

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      await ensureOllamaPermission();
      const reply = await chat([system, ...next], settings.ollamaModel);
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch {
      setMessages([
        ...next,
        { role: "assistant", content: "(Ollama unavailable — check Settings → Local AI.)" },
      ]);
    }
    setBusy(false);
  }

  return (
    <Overlay open={open} onClose={onClose} labelledBy="ask-title">
      <div className="w-[560px] max-w-[92vw] h-[70vh] flex flex-col bg-popover border border-border rounded-[14px] overflow-hidden shadow-[0_40px_100px_-30px_#000]">
        <div className="px-5 py-4 border-b border-hairline flex items-center justify-between">
          <h2 id="ask-title" className="text-[15px] font-semibold text-ink">Ask about your tabs</h2>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 grid place-items-center rounded-[7px] text-faint hover:text-ink border border-border">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {messages.length === 0 && (
            <p className="text-[13px] text-faint">
              e.g. "Which of these can I safely close?" or "Group my tabs by project."
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`text-[13px] leading-relaxed whitespace-pre-wrap rounded-[10px] px-3.5 py-2.5 ${
                m.role === "user"
                  ? "bg-accent/15 text-ink ml-10"
                  : "bg-white/[0.04] text-muted mr-10"
              }`}
            >
              {m.content}
            </div>
          ))}
          {busy && <div className="text-[12px] text-faint">Thinking…</div>}
        </div>

        <div className="p-4 border-t border-hairline flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            autoFocus
            placeholder="Ask about your tabs…"
            className="flex-1 bg-white/[0.04] border border-border rounded-[10px] px-3.5 py-2.5 text-[14px] text-ink outline-none placeholder:text-faint"
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="text-[13px] text-white bg-accent border border-accent rounded-[10px] px-4 disabled:opacity-40 hover:brightness-110 transition-all"
          >
            Send
          </button>
        </div>
      </div>
    </Overlay>
  );
}
