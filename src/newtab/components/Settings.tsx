import React, { useState, useTransition } from "react";
import { useTabStore } from "../../store/tabStore";
import type { AppSettings } from "../../types/index";

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

  React.useEffect(() => {
    setLocal(storeSettings);
  }, [storeSettings]);

  function handleSave() {
    startTransition(async () => {
      try {
        await chrome.storage.sync.set({ settings: local });
        setSettings(local);
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
    "w-full bg-gray-800/80 border border-gray-700/60 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/30 transition-all";
  const labelClass =
    "block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider";
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
        className={`drawer-panel fixed top-0 right-0 h-full w-96 z-50 bg-gray-900 border-l border-gray-800/60 shadow-2xl flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800/60">
          <div className="flex items-center gap-2.5">
            <svg
              className="w-4 h-4 text-indigo-400"
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
            <h2 className="font-semibold text-gray-100 text-base">Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-all"
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
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium capitalize transition-all ${
                    local.theme === t
                      ? "bg-indigo-600 text-white shadow-lg shadow-indigo-900/40"
                      : "bg-gray-800/60 text-gray-400 hover:bg-gray-800 border border-gray-700/40"
                  }`}
                >
                  {t === "dark" ? "🌙 Dark" : "☀️ Light"}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-600 mt-1">
              Light theme applies on next page load.
            </p>
          </div>

          <div className="border-t border-gray-800/60" />

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
              <span className="text-sm text-gray-500 whitespace-nowrap">
                hours
              </span>
            </div>
            <p className="text-xs text-gray-600 mt-1">
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
              <button
                onClick={() =>
                  update(
                    "unvisitedAutoCloseEnabled",
                    !local.unvisitedAutoCloseEnabled,
                  )
                }
                className={`relative w-10 h-5 rounded-full transition-all flex-shrink-0 ${
                  local.unvisitedAutoCloseEnabled
                    ? "bg-indigo-600"
                    : "bg-gray-700"
                }`}
                role="switch"
                aria-checked={local.unvisitedAutoCloseEnabled}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                    local.unvisitedAutoCloseEnabled
                      ? "translate-x-5"
                      : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            <p className="text-xs text-gray-600">
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
                <span className="text-sm text-gray-500 whitespace-nowrap">
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
              <span className="text-sm text-gray-500 whitespace-nowrap">
                tabs
              </span>
            </div>
            <p className="text-xs text-gray-600 mt-1">
              Show a warning badge when you exceed this number of open tabs.
            </p>
          </div>
        </div>

        {/* Save */}
        <div className="p-5 border-t border-gray-800/60">
          <button
            onClick={handleSave}
            disabled={isPending}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-all shadow-lg shadow-indigo-900/30"
          >
            {saved ? "✓ Saved!" : isPending ? "Saving…" : "Save Settings"}
          </button>
        </div>
      </aside>
    </>
  );
}
