import React, { useState, useRef, useEffect } from "react";
import Fuse from "fuse.js";
import { useTabStore } from "../../store/tabStore";
import type { EnrichedTab } from "../../types/index";

interface SearchBarProps {
  inputRef?: React.RefObject<HTMLInputElement>;
}

export default function SearchBar({ inputRef }: SearchBarProps) {
  const tabs = useTabStore((s) => s.tabs);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EnrichedTab[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const localRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Prefer the forwarded ref, fall back to local
  const resolvedRef = (inputRef ??
    localRef) as React.RefObject<HTMLInputElement>;

  const fuse = new Fuse(tabs, {
    keys: ["title", "url", "domain"],
    threshold: 0.35,
    includeScore: true,
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    setActiveIdx(-1);
    if (!val.trim()) {
      setResults([]);
      return;
    }
    setResults(fuse.search(val, { limit: 12 }).map((h) => h.item));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (activeIdx >= 0 && results[activeIdx]) jumpTo(results[activeIdx]);
    } else if (e.key === "Escape") {
      setQuery("");
      setResults([]);
      setActiveIdx(-1);
      resolvedRef.current?.blur();
    }
  }

  async function jumpTo(tab: EnrichedTab) {
    try {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch (e) {
      console.error("[TMC] search jumpTo error:", e);
    }
    setQuery("");
    setResults([]);
  }

  function clearSearch() {
    setQuery("");
    setResults([]);
    setActiveIdx(-1);
  }

  // Close dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (
        !resolvedRef.current?.contains(e.target as Node) &&
        !listRef.current?.contains(e.target as Node)
      ) {
        clearSearch();
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div className="relative w-full">
      <div className="relative">
        {/* Search icon */}
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
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
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </span>

        <input
          ref={resolvedRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Search tabs by title, URL, or domain… (⌘K)"
          className="w-full bg-gray-800/70 border border-gray-700/50 rounded-lg pl-9 pr-8 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/30 focus:bg-gray-800 transition-all"
          aria-label="Search tabs"
          aria-autocomplete="list"
          aria-controls={results.length > 0 ? "search-results" : undefined}
          aria-activedescendant={
            activeIdx >= 0 ? `search-result-${activeIdx}` : undefined
          }
        />

        {query && (
          <button
            onClick={clearSearch}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-600 hover:text-gray-300 transition-colors rounded"
            aria-label="Clear search"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Results dropdown */}
      {results.length > 0 && (
        <div
          ref={listRef}
          id="search-results"
          role="listbox"
          className="absolute top-full left-0 right-0 mt-1.5 bg-gray-900 border border-gray-700/60 rounded-xl shadow-2xl shadow-black/70 overflow-hidden z-50 max-h-80 overflow-y-auto animate-scale-in"
        >
          {results.map((tab, idx) => (
            <div
              key={tab.id}
              id={`search-result-${idx}`}
              role="option"
              aria-selected={idx === activeIdx}
              onClick={() => jumpTo(tab)}
              className={`flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-colors text-sm ${
                idx === activeIdx
                  ? "bg-indigo-600/20 text-indigo-100"
                  : "hover:bg-gray-800 text-gray-300"
              }`}
            >
              {tab.favIconUrl ? (
                <img
                  src={tab.favIconUrl}
                  alt=""
                  className="w-4 h-4 rounded-sm flex-shrink-0"
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
              ) : (
                <div className="w-4 h-4 rounded-sm bg-gray-700 flex-shrink-0" />
              )}
              <span className="flex-1 truncate">{tab.title || tab.url}</span>
              <span className="text-xs text-gray-600 ml-2 flex-shrink-0 bg-gray-800 px-1.5 py-0.5 rounded-md">
                {tab.domain}
              </span>
            </div>
          ))}

          {/* Keyboard hint footer */}
          <div className="px-3 py-1.5 border-t border-gray-800/80 flex items-center gap-3 text-xs text-gray-600 bg-gray-900/50">
            <span>
              <kbd>↑↓</kbd> navigate
            </span>
            <span>
              <kbd>↵</kbd> jump to tab
            </span>
            <span>
              <kbd>Esc</kbd> close
            </span>
            <span className="ml-auto">
              {results.length} result{results.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
