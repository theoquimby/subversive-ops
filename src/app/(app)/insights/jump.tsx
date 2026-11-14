"use client";

import { useEffect, useState } from "react";
import { cx } from "@/components/ui";

/**
 * Section shortcuts under the page title: the page is long on a phone, so
 * these stick under the top bar and light up the section you're in.
 */
export function JumpNav({ links }: { links: { href: string; label: string; count?: number }[] }) {
  const [current, setCurrent] = useState(links[0]?.href ?? "");
  useEffect(() => {
    const els = links.map((l) => document.querySelector(l.href)).filter((e): e is Element => !!e);
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (seen) setCurrent(`#${seen.target.id}`);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [links]);
  return (
    <nav aria-label="Sections" className="sticky top-[calc(3.25rem+env(safe-area-inset-top))] z-20 -mx-4 -mt-3 mb-7 border-b border-transparent bg-bg/85 px-4 py-2.5 backdrop-blur-xl sm:-mx-8 sm:px-8 lg:top-0">
      <ul className="lab-noscroll flex gap-1 overflow-x-auto">
        {links.map((l) => (
          <li key={l.href} className="shrink-0">
            <a
              href={l.href}
              aria-current={current === l.href ? "true" : undefined}
              onClick={() => setCurrent(l.href)}
              className={cx("inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[0.82rem] whitespace-nowrap transition-colors", current === l.href ? "bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(0_0_0/0.05)]" : "text-ink-2 hover:text-ink")}
            >
              {l.label}
              {l.count != null && <span className="num rounded-full bg-surface-2 px-1.5 text-[0.7rem] text-muted">{l.count}</span>}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
