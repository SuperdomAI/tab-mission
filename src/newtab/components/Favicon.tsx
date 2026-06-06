import { useState, useEffect } from "react";
import type { EnrichedTab } from "../../types/index";
import { faviconUrl, letterFor } from "../../lib/faviconUrl";

interface FaviconProps {
  tab: Pick<EnrichedTab, "url" | "domain" | "title">;
  /** rendered box size in px */
  size?: number;
  /** favicon fetch resolution (defaults to 2x size for crispness) */
  res?: number;
  rounded?: number;
  className?: string;
}

/**
 * Favicon-as-hero. Tries Chrome's `_favicon/` endpoint (needs the "favicon"
 * permission); on empty URL or load error, falls back to a letter tile so a
 * deck/card is never blank — the whole design rests on recognizable objects.
 */
export default function Favicon({
  tab,
  size = 32,
  res,
  rounded = 8,
  className = "",
}: FaviconProps) {
  const src = faviconUrl(tab.url, res ?? size * 2);
  const [failed, setFailed] = useState(src === "");

  // reset when the tab/url changes
  useEffect(() => setFailed(src === ""), [src]);

  const box = {
    width: size,
    height: size,
    borderRadius: rounded,
  } as const;

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-popover text-muted font-semibold select-none ${className}`}
        style={{ ...box, fontSize: Math.round(size * 0.42) }}
        aria-hidden
      >
        {letterFor(tab)}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`object-contain bg-popover ${className}`}
      style={box}
    />
  );
}
