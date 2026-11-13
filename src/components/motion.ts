"use client";

/**
 * Shared motion helpers. Tokens live in globals.css (--dur-*, --motion-*);
 * these are the JS-side twins for floating-ui transitions and presence.
 */

import type { Placement, Side, UseTransitionStylesProps } from "@floating-ui/react";
import { useEffect, useState, useSyncExternalStore } from "react";

export const DUR = { fast: 120, base: 180, slow: 260 } as const;
export const EASE = {
  out: "cubic-bezier(.2,.8,.2,1)",
  inOut: "cubic-bezier(.4,0,.2,1)",
  sheet: "cubic-bezier(.32,.72,0,1)",
} as const;

const RM = "(prefers-reduced-motion: reduce)";
const subscribeRM = (cb: () => void) => {
  const mq = window.matchMedia(RM);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia(RM).matches;
export const useReducedMotion = () => useSyncExternalStore(subscribeRM, prefersReducedMotion, () => false);

/** Grow from the edge that touches the trigger: a menu below a button scales out of its top. */
export function originFor(placement: Placement) {
  const [side, align] = placement.split("-") as [Side, "start" | "end" | undefined];
  const cross = align === "start" ? "left" : align === "end" ? "right" : "center";
  const crossV = align === "start" ? "top" : align === "end" ? "bottom" : "center";
  switch (side) {
    case "bottom": return `top ${cross}`;
    case "top": return `bottom ${cross}`;
    case "left": return `${crossV} right`;
    case "right": return `${crossV} left`;
  }
}

/** Popover/menu: scale .96→1 + fade from the reference side. Snappy close. */
export function popoverTransition(reduced: boolean): UseTransitionStylesProps {
  if (reduced) return { duration: { open: 60, close: 0 }, initial: { opacity: 0 } };
  return {
    duration: { open: DUR.base, close: DUR.fast },
    initial: { opacity: 0, transform: "scale(.96)" },
    common: ({ placement }) => ({ transformOrigin: originFor(placement), transitionTimingFunction: EASE.out }),
  };
}

/** Bottom sheet: slides the full height with the emphasized easing. */
export function sheetTransition(reduced: boolean): UseTransitionStylesProps {
  if (reduced) return { duration: { open: 60, close: 0 }, initial: { opacity: 0 } };
  return {
    duration: { open: DUR.slow, close: 200 },
    initial: { transform: "translateY(100%)" },
    common: { transitionTimingFunction: EASE.sheet },
  };
}

/**
 * Keep something mounted while it animates out. `closing` is true for
 * `exitMs` after `open` turns false; put `data-closing` on the element so the
 * CSS exit animation runs, then it unmounts.
 */
export function usePresence(open: boolean, exitMs: number = DUR.fast) {
  const reduced = useReducedMotion();
  const [lingering, setLingering] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open && !reduced) setLingering(true);
  }
  useEffect(() => {
    if (!lingering) return;
    const t = setTimeout(() => setLingering(false), exitMs);
    return () => clearTimeout(t);
  }, [lingering, exitMs]);
  return { mounted: open || lingering, closing: !open && lingering };
}
