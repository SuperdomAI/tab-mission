import { motion, useReducedMotion } from "framer-motion";
import type { EnrichedTab } from "../../types/index";
import Favicon from "./Favicon";
import { tabStatus, STATUS_META, type TabStatus } from "../../lib/tabStatus";

interface DeckProps {
  domain: string;
  tabs: EnrichedTab[];
  onOpen: () => void;
}

const DOT_ORDER: TabStatus[] = ["recent", "stale", "unvisited", "hibernated"];

/** A site rendered as a Wallet-style card stack; depth = tab count. */
export default function Deck({ domain, tabs, onOpen }: DeckProps) {
  const reduce = useReducedMotion();
  const depth = Math.min(tabs.length, 3);
  const preview = tabs.map((t) => t.title || t.domain).slice(0, 4).join(" · ");

  const statuses = new Set(tabs.map((t) => tabStatus(t)));
  const dots = DOT_ORDER.filter((s) => statuses.has(s));

  return (
    <motion.button
      onClick={onOpen}
      whileHover={reduce ? undefined : { y: -6 }}
      transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
      className="relative block text-left w-full h-[136px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-[16px]"
      aria-label={`${domain}, ${tabs.length} tabs`}
    >
      {/* stacked cards behind */}
      {depth > 2 && (
        <div className="absolute left-3.5 right-3.5 top-3.5 h-[110px] rounded-[16px] bg-[#15171b] border border-hairline opacity-60" />
      )}
      {depth > 1 && (
        <div className="absolute left-[7px] right-[7px] top-2 h-[120px] rounded-[16px] bg-[#181a1f] border border-hairline opacity-90" />
      )}
      {/* face */}
      <div className="absolute inset-x-0 top-0 h-[128px] rounded-[16px] bg-surface border border-hairline px-[18px] py-4 flex flex-col justify-between shadow-[0_18px_40px_-20px_rgba(0,0,0,0.7)]">
        <div className="flex items-center gap-3">
          <Favicon tab={{ url: tabs[0]?.url ?? "", domain, title: domain }} size={30} rounded={9} />
          <span className="text-[15px] font-semibold text-ink truncate">{domain}</span>
        </div>
        <div className="text-[13px] text-muted truncate">{preview}</div>
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[11px] text-faint">
            {tabs.length} tab{tabs.length !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-1.5 ml-auto">
            {dots.map((s) => (
              <span
                key={s}
                title={STATUS_META[s].label}
                style={{ background: `var(${STATUS_META[s].cssVar})` }}
                className="w-[7px] h-[7px] rounded-full"
              />
            ))}
          </span>
        </div>
      </div>
    </motion.button>
  );
}
