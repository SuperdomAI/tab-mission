import React from "react";
import { format } from "date-fns";
import { useSession } from "../hooks/useSession";

interface SessionManagerProps {
  open: boolean;
  onClose: () => void;
}

export default function SessionManager({ open, onClose }: SessionManagerProps) {
  const { sessions, restoreSession, deleteSession, saveSession, isPending } =
    useSession();

  function handleSave() {
    const name = prompt(
      "Session name:",
      `Session ${new Date().toLocaleString()}`,
    );
    if (name) saveSession(name);
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      <aside
        className={`drawer-panel fixed top-0 right-0 h-full w-80 z-50 bg-gray-900 border-l border-gray-800/60 shadow-2xl flex flex-col ${
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
                d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
              />
            </svg>
            <h2 className="font-semibold text-gray-100 text-base">Sessions</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleSave()}
              disabled={isPending}
              className="text-xs bg-indigo-600/80 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-lg transition-all disabled:opacity-50 font-medium"
            >
              + Save current
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-all"
              aria-label="Close"
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
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {sessions.length === 0 ? (
            <div className="text-center py-14">
              <div className="w-12 h-12 rounded-2xl bg-gray-800/60 border border-gray-700/40 flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-6 h-6 text-gray-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                  />
                </svg>
              </div>
              <p className="text-sm text-gray-500">No saved sessions yet.</p>
              <p className="text-xs mt-1 text-gray-600">
                Save your current tabs as a session to restore them later.
              </p>
            </div>
          ) : (
            [...sessions].reverse().map((session) => (
              <div
                key={session.id}
                className="bg-gray-800/60 rounded-xl p-3.5 border border-gray-700/40 hover:border-gray-600/50 transition-all group"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-200 truncate">
                      {session.name}
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {format(session.savedAt, "MMM d, yyyy · h:mm a")}
                    </p>
                  </div>
                  <span className="text-xs bg-gray-700/60 text-gray-400 px-2 py-0.5 rounded-full border border-gray-600/30 flex-shrink-0 tabular-nums">
                    {session.tabs.length} tab
                    {session.tabs.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Tab preview */}
                <div className="space-y-1 max-h-20 overflow-hidden mb-3">
                  {session.tabs.slice(0, 4).map((tab, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 text-xs text-gray-500 truncate"
                    >
                      {tab.favIconUrl ? (
                        <img
                          src={tab.favIconUrl}
                          alt=""
                          className="w-3 h-3 rounded-sm flex-shrink-0 opacity-70"
                          onError={(e) =>
                            (e.currentTarget.style.display = "none")
                          }
                        />
                      ) : (
                        <div className="w-3 h-3 rounded-sm bg-gray-700 flex-shrink-0" />
                      )}
                      <span className="truncate">{tab.title || tab.url}</span>
                    </div>
                  ))}
                  {session.tabs.length > 4 && (
                    <p className="text-xs text-gray-600">
                      +{session.tabs.length - 4} more…
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => restoreSession(session.id)}
                    disabled={isPending}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white text-xs font-medium disabled:opacity-50 transition-all flex items-center justify-center gap-1.5"
                  >
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                    Restore
                  </button>
                  <button
                    onClick={() => deleteSession(session.id)}
                    disabled={isPending}
                    className="px-2.5 py-1.5 rounded-lg bg-gray-700/60 hover:bg-red-900/40 text-gray-400 hover:text-red-400 text-xs disabled:opacity-50 transition-all border border-gray-600/30 hover:border-red-800/40"
                    aria-label="Delete session"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
