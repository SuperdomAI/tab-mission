interface SwitchProps {
  checked: boolean;
  onChange: () => void;
  label?: string;
}

/**
 * Accessible on/off switch. Track + knob positions use inline styles (not
 * Tailwind translate utilities) so the off/on appearance is always correct:
 * off = muted track + knob left, on = accent track + knob right.
 */
export default function Switch({ checked, onChange, label }: SwitchProps) {
  const W = 38;
  const H = 22;
  const KNOB = 16;
  const PAD = 3;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className="relative inline-flex flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      style={{
        width: W,
        height: H,
        background: checked ? "var(--accent)" : "var(--color-border)",
      }}
    >
      <span
        className="rounded-full bg-white shadow"
        style={{
          width: KNOB,
          height: KNOB,
          transform: `translateX(${checked ? W - KNOB - PAD : PAD}px)`,
          transition: "transform 0.18s cubic-bezier(0.2,0.7,0.2,1)",
        }}
      />
    </button>
  );
}
