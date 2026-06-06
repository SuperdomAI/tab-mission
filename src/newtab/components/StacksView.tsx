import { useState, useMemo } from "react";
import { useTabStore, useShallow, selectTabsByDomain, selectDomainsSorted } from "../../store/tabStore";
import Deck from "./Deck";
import DeckPopover from "./DeckPopover";

/** Default view: every site as a Wallet-style deck; click → popover. */
export default function StacksView() {
  const tabs = useTabStore((s) => s.tabs);
  const [openDomain, setOpenDomain] = useState<string | null>(null);

  // Memoized so frequent storage writes don't re-group on every render.
  const byDomain = useMemo(() => selectTabsByDomain(tabs), [tabs]);
  const domains = useMemo(() => selectDomainsSorted(byDomain), [byDomain]);

  const openTabs = openDomain ? (byDomain.get(openDomain) ?? []) : [];

  // If the open deck emptied (all its tabs closed), dismiss the popover.
  if (openDomain && openTabs.length === 0 && tabs.length >= 0) {
    // defer to avoid setState during render
    queueMicrotask(() => setOpenDomain((d) => (d === openDomain ? null : d)));
  }

  return (
    <>
      <div className="label-mono mb-4 px-1">Your stacks</div>
      <div className="grid gap-[22px_18px] [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
        {domains.map((domain) => (
          <Deck
            key={domain}
            domain={domain}
            tabs={byDomain.get(domain)!}
            onOpen={() => setOpenDomain(domain)}
          />
        ))}
      </div>
      <DeckPopover
        domain={openDomain ?? ""}
        tabs={openTabs}
        open={openDomain !== null && openTabs.length > 0}
        onClose={() => setOpenDomain(null)}
      />
    </>
  );
}
