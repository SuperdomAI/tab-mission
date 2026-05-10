import React, { useRef, useState, useCallback } from "react";
import ReactDOM from "react-dom";

interface TooltipProps {
  text: string;
  children: React.ReactNode;
  className?: string;
}

type Placement = "top" | "bottom" | "left" | "right";

interface TooltipState {
  visible: boolean;
  placement: Placement;
  wrapperStyle: React.CSSProperties;
  arrowStyle: React.CSSProperties;
}

const BG = "#374151"; // gray-700
const GAP = 8; // px between anchor edge and tooltip bubble
const DELAY = 300; // ms before showing

function computePlacement(rect: DOMRect): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Minimum clearance needed on each axis before preferring that direction
  if (rect.top >= 44) return "top";
  if (vh - rect.bottom >= 44) return "bottom";
  if (vw - rect.right >= 100) return "right";
  return "left";
}

function buildStyles(
  rect: DOMRect,
  placement: Placement,
): Pick<TooltipState, "wrapperStyle" | "arrowStyle"> {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const base: React.CSSProperties = {
    position: "fixed",
    zIndex: 99999,
    pointerEvents: "none",
    padding: "6px 10px",
    fontSize: "12px",
    fontWeight: 500,
    color: "#f3f4f6",
    backgroundColor: BG,
    borderRadius: "6px",
    whiteSpace: "nowrap",
    boxShadow:
      "0 4px 6px -1px rgba(0,0,0,0.35), 0 2px 4px -2px rgba(0,0,0,0.2)",
    lineHeight: 1.4,
  };

  const arrowBase: React.CSSProperties = {
    position: "absolute",
    width: 0,
    height: 0,
  };

  switch (placement) {
    case "top":
      return {
        wrapperStyle: {
          ...base,
          left: cx,
          top: rect.top - GAP,
          transform: "translateX(-50%) translateY(-100%)",
        },
        arrowStyle: {
          ...arrowBase,
          bottom: -4,
          left: "50%",
          transform: "translateX(-50%)",
          borderLeft: "4px solid transparent",
          borderRight: "4px solid transparent",
          borderTop: `4px solid ${BG}`,
        },
      };
    case "bottom":
      return {
        wrapperStyle: {
          ...base,
          left: cx,
          top: rect.bottom + GAP,
          transform: "translateX(-50%)",
        },
        arrowStyle: {
          ...arrowBase,
          top: -4,
          left: "50%",
          transform: "translateX(-50%)",
          borderLeft: "4px solid transparent",
          borderRight: "4px solid transparent",
          borderBottom: `4px solid ${BG}`,
        },
      };
    case "right":
      return {
        wrapperStyle: {
          ...base,
          left: rect.right + GAP,
          top: cy,
          transform: "translateY(-50%)",
        },
        arrowStyle: {
          ...arrowBase,
          left: -4,
          top: "50%",
          transform: "translateY(-50%)",
          borderTop: "4px solid transparent",
          borderBottom: "4px solid transparent",
          borderRight: `4px solid ${BG}`,
        },
      };
    case "left":
      return {
        wrapperStyle: {
          ...base,
          left: rect.left - GAP,
          top: cy,
          transform: "translateX(-100%) translateY(-50%)",
        },
        arrowStyle: {
          ...arrowBase,
          right: -4,
          top: "50%",
          transform: "translateY(-50%)",
          borderTop: "4px solid transparent",
          borderBottom: "4px solid transparent",
          borderLeft: `4px solid ${BG}`,
        },
      };
  }
}

export default function Tooltip({
  text,
  children,
  className = "",
}: TooltipProps) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [state, setState] = useState<TooltipState>({
    visible: false,
    placement: "top",
    wrapperStyle: {},
    arrowStyle: {},
  });

  const show = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const placement = computePlacement(rect);
    const { wrapperStyle, arrowStyle } = buildStyles(rect, placement);
    setState({ visible: true, placement, wrapperStyle, arrowStyle });
  }, []);

  const handleMouseEnter = useCallback(() => {
    timerRef.current = setTimeout(show, DELAY);
  }, [show]);

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setState((s) => ({ ...s, visible: false }));
  }, []);

  return (
    <div
      ref={triggerRef}
      className={`inline-flex ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {state.visible &&
        ReactDOM.createPortal(
          <div role="tooltip" style={state.wrapperStyle}>
            {text}
            <span style={state.arrowStyle} />
          </div>,
          document.body,
        )}
    </div>
  );
}
