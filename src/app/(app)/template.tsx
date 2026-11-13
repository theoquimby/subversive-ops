"use client";

/**
 * Page enter. Every client navigation fades the new page in with a 6px rise
 * (260ms, --motion-out); top-level blocks follow each other by 25ms (capped)
 * and the first rows of short tables trail in behind them. The very first
 * paint is never animated, so server-rendered content shows at once.
 *
 * Content that streams in later (a page replacing its loading.tsx skeleton)
 * just fades, so nothing jumps under the reader.
 *
 * Animations use the Web Animations API on transform/opacity only. A block
 * that contains position:fixed UI (bottom action bars) only fades: a transform
 * would make the bar ride along with the block for a moment.
 */

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";
import { prefersReducedMotion } from "@/components/motion";

// The path the template last showed. The first mount ever (hard load / sign-in)
// never animates; a re-run for the same path (React StrictMode in dev) doesn't either.
let lastPath: string | null = null;
const EASE = "cubic-bezier(.2,.8,.2,1)";
const hasFixed = (el: Element) => el.matches('[class*="fixed"]') || !!el.querySelector('[class*="fixed"]');

function enter(root: HTMLElement, seen: WeakSet<Element>) {
  const reduced = prefersReducedMotion();
  const blocks = Array.from(root.children);
  blocks.forEach((el, i) => {
    seen.add(el);
    if (reduced) return;
    const rise = !hasFixed(el);
    el.animate(rise ? [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }] : [{ opacity: 0 }, { opacity: 1 }], {
      duration: 260,
      delay: Math.min(i * 25, 100),
      easing: EASE,
      fill: "backwards",
    });
  });
  if (reduced) return;
  // Small tables (≤ 10 rows): every row trails in, total stagger ≤ 150ms. Bigger ones just come in with their block.
  root.querySelectorAll("tbody").forEach((tb) => {
    const rows = Array.from(tb.children);
    if (rows.length < 2 || rows.length > 10) return;
    const step = Math.min(18, 150 / rows.length);
    rows.forEach((row, i) => row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 40 + i * step, easing: EASE, fill: "backwards" }));
  });
}

export default function Template({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const seen = useRef(new WeakSet<Element>());

  // Before paint, so the new page never shows un-animated for a frame.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const first = lastPath === null;
    const same = lastPath === pathname;
    lastPath = pathname;
    if (first || same) {
      Array.from(root.children).forEach((el) => seen.current.add(el));
      return;
    }
    enter(root, seen.current);
  }, [pathname]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // Streamed-in content (skeleton → page): a quiet fade, no travel.
    const mo = new MutationObserver((records) => {
      const reduced = prefersReducedMotion();
      for (const r of records)
        r.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement) || seen.current.has(n)) return;
          seen.current.add(n);
          if (!reduced) n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: EASE });
        });
    });
    mo.observe(root, { childList: true });
    return () => mo.disconnect();
  }, []);

  return <div ref={ref}>{children}</div>;
}
