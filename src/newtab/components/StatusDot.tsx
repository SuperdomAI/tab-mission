import type { EnrichedTab } from "../../types/index";
import { tabStatus, STATUS_META } from "../../lib/tabStatus";

/** Quiet status indicator — color = information. */
export default function StatusDot({
  tab,
  size = 7,
  now,
}: {
  tab: EnrichedTab;
  size?: number;
  now?: number;
}) {
  const status = tabStatus(tab, now);
  if (status === "normal") return null;
  const { cssVar, label } = STATUS_META[status];
  return (
    <span
      title={label}
      aria-label={label}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: `var(${cssVar})`,
        display: "inline-block",
        flex: "none",
      }}
    />
  );
}
