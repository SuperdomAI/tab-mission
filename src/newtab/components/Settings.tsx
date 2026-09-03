import React, { useState, useTransition } from "react";
import { useTabStore } from "../../store/tabStore";
import type { AppSettings } from "../../types/index";
import { ensureOllamaPermission, detectOllama, listModels } from "../../lib/ollama";
import { pickMissingModels, recommendedProfile } from "../../lib/ai/models";
import {
  requestPageReadingPermission,
  revokePageReadingPermission,
} from "../../lib/pageReading";
import Switch from "./Switch";

interface SettingsProps {
  open: boolean;
  onClose: () => void;
}

export default function Settings({ open, onClose }: SettingsProps) {
  const storeSettings = useTabStore((s) => s.settings);
  const setSettings = useTabStore((s) => s.setSettings);
  const [local, setLocal] = useState<AppSettings>(storeSettings);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [aiStatus, setAiStatus] = useState("");
  const [pageStatus, setPageStatus] = useState("");

  // F6 — "Read pages for AI" requests the optional `scripting` + <all_urls>
  // host grants at this explicit opt-in moment, and revokes them on opt-out
  // (optional permissions can be removed programmatically). Every other
  // feature works without these grants.
  async function togglePageReading() {
    const next = !local.aiPageReadingEnabled;
    if (next) {
      setPageStatus("Requesting page-reading permission…");
      const granted = await requestPageReadingPermission();
      if (!granted) {
        setPageStatus("Permission denied — page reading stays off.");
        return;
      }
      setPageStatus("Enabled — Summarize & close is available (revocable anytime).");
    } else {
      await revokePageReadingPermission();
      setPageStatus("");
    }
    update("aiPageReadingEnabled", next);
  }

  async function toggleOllama() {
    const next = !local.ollamaEnabled;
    update("ollamaEnabled", next);
    if (!next) {
      setAiStatus("");
      return;
    }
    setAiStatus("Requesting permission…");
    const granted = await ensureOllamaPermission();
    if (!granted) {
      update("ollamaEnabled", false);
      setAiStatus("Permission denied — AI stays off.");
      return;
    }
    setAiStatus("Checking for Ollama…");
    const up = await detectOllama();
    if (!up) {
      setAiStatus(
        "Not detected. Start Ollama with OLLAMA_ORIGINS allowing this extension (see below).",
      );
      return;
    }
    const models = await listModels();
    if (models.length === 0) {
      setAiStatus(
        "Connected — no models installed yet. Pull one with `ollama pull` (see hints below).",
      );
      return;
    }
    const picked = pickMissingModels(
      { fast: local.aiFastModel, chat: local.aiChatModel, embed: local.aiEmbedModel },
      models,
    );
    setLocal((prev) => ({
      ...prev,
      aiFastModel: picked.fast,
      aiChatModel: picked.chat,
      aiEmbedModel: picked.embed,
      // Legacy alias — AskAI and Focus now read aiChatModel; keep the stored
      // field coherent for anyone who downgrades the extension.
      ollamaModel: picked.chat,
    }));
    setAiStatus(`Connected — ${picked.chat} handles chat tasks.`);
  }

  React.useEffect(() => {
    setLocal(storeSettings);
  }, [storeSettings]);

  function handleSave() {
    startTransition(async () => {
      try {
        // Keep the legacy `ollamaModel` alias aligned with the chat tier.
        await chrome.storage.sync.set({
          settings: { ...local, ollamaModel: local.aiChatModel },
        });
        setSettings({ ...local, ollamaModel: local.aiChatModel });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (e) {
        console.error("[TMC] save settings error:", e);
      }
    });
  }

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setLocal((prev) => ({ ...prev, [key]: value }));
  }

  const inputClass =
    "w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition-all";
  const labelClass = "label-mono block mb-1.5";
  const sectionClass = "space-y-1.5";

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      <aside
        className={`drawer-panel fixed top-0 right-0 h-full w-96 z-50 bg-popover border-l border-hairline shadow-2xl flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
          <div className="flex items-center gap-2.5">
            <svg
              className="w-4 h-4 text-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <h2 className="font-semibold text-ink text-base">Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[9px] text-faint hover:text-ink hover:bg-white/[0.06] transition-colors"
            aria-label="Close settings"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Theme */}
          <div className={sectionClass}>
            <label className={labelClass}>Theme</label>
            <div className="flex gap-2">
              {(["dark", "light"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => update("theme", t)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium capitalize transition-colors ${
                    local.theme === t
                      ? "bg-accent/15 text-ink border border-accent/40"
                      : "bg-white/[0.04] text-muted hover:text-ink hover:bg-white/[0.07] border border-border"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <p className="text-xs text-faint mt-1">
              Light theme applies on next page load.
            </p>
          </div>

          <div className="border-t border-hairline" />

          {/* Zombie threshold */}
          <div className={sectionClass}>
            <label className={labelClass}>Zombie Tab Threshold</label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                className={inputClass}
                min={1}
                max={72}
                value={local.zombieThresholdHours}
                onChange={(e) =>
                  update(
                    "zombieThresholdHours",
                    Math.max(1, parseInt(e.target.value) || 3),
                  )
                }
              />
              <span className="text-sm text-muted whitespace-nowrap">
                hours
              </span>
            </div>
            <p className="text-xs text-faint mt-1">
              Tabs inactive longer than this are marked as zombies and can be
              bulk-closed.
            </p>
          </div>

          {/* Unvisited auto-close */}
          <div className={sectionClass}>
            <div className="flex items-center justify-between mb-2">
              <label className={labelClass + " mb-0"}>
                Auto-close Unvisited Tabs
              </label>
              <Switch
                checked={local.unvisitedAutoCloseEnabled}
                onChange={() =>
                  update(
                    "unvisitedAutoCloseEnabled",
                    !local.unvisitedAutoCloseEnabled,
                  )
                }
                label="Auto-close unvisited tabs"
              />
            </div>
            <p className="text-xs text-faint">
              Automatically close tabs that were never visited after the
              specified time.
            </p>
            {local.unvisitedAutoCloseEnabled && (
              <div className="mt-2 flex items-center gap-3">
                <input
                  type="number"
                  className={inputClass}
                  min={5}
                  max={1440}
                  value={local.unvisitedAutoCloseMinutes}
                  onChange={(e) =>
                    update(
                      "unvisitedAutoCloseMinutes",
                      Math.max(5, parseInt(e.target.value) || 30),
                    )
                  }
                />
                <span className="text-sm text-muted whitespace-nowrap">
                  minutes
                </span>
              </div>
            )}
          </div>

          {/* Tab limit warning */}
          <div className={sectionClass}>
            <label className={labelClass}>Tab Count Warning</label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                className={inputClass}
                min={5}
                max={500}
                value={local.tabLimitWarning}
                onChange={(e) =>
                  update(
                    "tabLimitWarning",
                    Math.max(5, parseInt(e.target.value) || 30),
                  )
                }
              />
              <span className="text-sm text-muted whitespace-nowrap">
                tabs
              </span>
            </div>
            <p className="text-xs text-faint mt-1">
              Show a warning badge when you exceed this number of open tabs.
            </p>
          </div>

          <div className="border-t border-hairline" />

          {/* Local AI (Ollama) — optional */}
          <div className={sectionClass}>
            <div className="flex items-center justify-between mb-2">
              <label className={labelClass + " mb-0"}>Local AI (Ollama)</label>
              <Switch
                checked={local.ollamaEnabled}
                onChange={toggleOllama}
                label="Local AI (Ollama)"
              />
            </div>
            <p className="text-xs text-faint">
              Optional. Lets the Focus view "Refine with AI" using a local Ollama
              model. Everything stays on your machine — no cloud, no keys. Core
              features work without it.
            </p>
            {aiStatus && <p className="text-xs text-accent mt-1.5">{aiStatus}</p>}
            {local.ollamaEnabled && (
              <>
                {/* Per-tier models */}
                <div className="mt-2 space-y-2.5">
                  <div>
                    <label className={labelClass}>Chat Model</label>
                    <input
                      type="text"
                      className={inputClass}
                      value={local.aiChatModel}
                      onChange={(e) => update("aiChatModel", e.target.value)}
                      placeholder="qwen2.5:7b-instruct-q4_K_M"
                    />
                    <p className="text-xs text-faint mt-1">
                      Ask AI, daily debrief, and the weekly coach.
                    </p>
                  </div>
                  <div>
                    <label className={labelClass}>Fast Model</label>
                    <input
                      type="text"
                      className={inputClass}
                      value={local.aiFastModel}
                      onChange={(e) => update("aiFastModel", e.target.value)}
                      placeholder="qwen2.5:3b-instruct-q4_K_M"
                    />
                    <p className="text-xs text-faint mt-1">
                      Triage and proactive suggestions.
                    </p>
                  </div>
                  <div>
                    <label className={labelClass}>Embed Model</label>
                    <input
                      type="text"
                      className={inputClass}
                      value={local.aiEmbedModel}
                      onChange={(e) => update("aiEmbedModel", e.target.value)}
                      placeholder="nomic-embed-text"
                    />
                    <p className="text-xs text-faint mt-1">
                      Semantic search over your tabs.
                    </p>
                  </div>
                </div>
                <p className="text-xs text-faint mt-2">
                  Recommended stack (16 GB):
                  <code className="block mt-1 font-mono bg-surface rounded px-2 py-1 text-muted">
                    ollama pull {recommendedProfile().chat} && ollama pull{" "}
                    {recommendedProfile().fast} && ollama pull{" "}
                    {recommendedProfile().embed}
                  </code>
                </p>
                <p className="text-xs text-faint mt-2">
                  Ollama must allow this extension's origin. Start it with:
                  <code className="block mt-1 font-mono bg-surface rounded px-2 py-1 text-muted">
                    OLLAMA_ORIGINS=chrome-extension://* ollama serve
                  </code>
                </p>

                {/* Read pages for AI */}
                <div className="mt-3 flex items-center justify-between">
                  <div>
                    <label className={labelClass + " mb-0"}>
                      Read Pages for AI
                    </label>
                    <p className="text-xs text-faint mt-0.5">
                      Lets AI summarize pages you close (optional, off by
                      default). Requests access to page content on first use
                      and can be revoked here or in chrome://extensions.
                    </p>
                  </div>
                  <Switch
                    checked={local.aiPageReadingEnabled}
                    onChange={() => void togglePageReading()}
                    label="Read pages for AI"
                  />
                </div>
                {pageStatus && (
                  <p className="text-xs text-accent mt-1.5">{pageStatus}</p>
                )}

                {/* Per-feature toggles */}
                <div className="mt-3 pt-3 border-t border-hairline space-y-2.5">
                  <div className={labelClass + " mb-1"}>Features</div>
                  <ToggleRow
                    label="Daily debrief"
                    checked={local.aiDebrief}
                    onChange={() => update("aiDebrief", !local.aiDebrief)}
                  />
                  <ToggleRow
                    label="AI triage"
                    checked={local.aiTriage}
                    onChange={() => update("aiTriage", !local.aiTriage)}
                  />
                  <ToggleRow
                    label="Proactive suggestions"
                    checked={local.aiSuggestions}
                    onChange={() => update("aiSuggestions", !local.aiSuggestions)}
                  />
                  <ToggleRow
                    label="Session memory"
                    checked={local.aiSessionMemory}
                    onChange={() => update("aiSessionMemory", !local.aiSessionMemory)}
                  />
                  <ToggleRow
                    label="Semantic search"
                    checked={local.aiSemanticSearch}
                    onChange={() => update("aiSemanticSearch", !local.aiSemanticSearch)}
                  />
                  <ToggleRow
                    label="Habits coach"
                    checked={local.aiCoach}
                    onChange={() => update("aiCoach", !local.aiCoach)}
                  />
                  <ToggleRow
                    label="Idle-time drafts"
                    checked={local.aiIdleDrafts}
                    onChange={() => update("aiIdleDrafts", !local.aiIdleDrafts)}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Save */}
        <div className="p-5 border-t border-hairline">
          <button
            onClick={handleSave}
            disabled={isPending}
            className="w-full py-2.5 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors"
          >
            {saved ? "Saved" : isPending ? "Saving…" : "Save Settings"}
          </button>
        </div>
      </aside>
    </>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted">{label}</span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}
