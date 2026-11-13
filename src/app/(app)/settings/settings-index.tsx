"use client";

import { HelpTip, HelpZone } from "@/components/help";
import { cn } from "@/lib/cn";
import { ArrowUpRight, ChevronRight, Search, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ITEMS, searchSettings, SECTIONS, sectionOf, type SettingsItem } from "./registry";

/** Old links (the command bar's "Suppliers") pointed at /settings#suppliers. */
const LEGACY_HASH: Record<string, string> = { "#suppliers": "/settings/suppliers" };

function Row({ item, value, showSection, waiting }: { item: SettingsItem; value?: string; showSection?: boolean; waiting?: number }) {
  return (
    <Link href={item.href} className="group flex items-center gap-3 px-4 py-3.5 transition-colors duration-120 hover:bg-surface-2/60 focus-visible:bg-surface-2/60 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-ink">{item.label}</span>
          {showSection && <span className="text-xs text-muted">{sectionOf(item.section).title}</span>}
          {!!waiting && <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[0.7rem] font-medium text-primary-ink"><Sparkles aria-hidden className="size-3" />{waiting} suggestion{waiting === 1 ? "" : "s"}</span>}
        </div>
        <p className={cn("mt-0.5 text-[0.8rem] text-muted", !showSection && "hidden sm:block")}>{item.what}</p>
      </div>
      {value && <span className="num max-w-[45%] shrink-0 truncate text-right text-[0.8rem] text-ink-2 sm:max-w-[16rem] sm:text-sm">{value}</span>}
      {item.elsewhere ? <ArrowUpRight aria-label="Opens another page" className="size-4 shrink-0 text-muted group-hover:text-ink" /> : <ChevronRight aria-hidden className="size-4 shrink-0 text-muted group-hover:text-ink" />}
    </Link>
  );
}

/** `suggestions`: learned suggestions waiting, per item id (a badge on the row). */
export function SettingsIndex({ values, suggestions = {} }: { values: Record<string, string>; suggestions?: Record<string, number> }) {
  const [q, setQ] = useState("");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchSettings(q, values), [q, values]);

  useEffect(() => {
    const to = LEGACY_HASH[window.location.hash];
    if (to) router.replace(to);
  }, [router]);

  return (
    <>
      <HelpZone id="settings.home.search" className="mb-8">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
          <input
            ref={input}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) router.push(results[0].href);
              if (e.key === "Escape") setQ("");
            }}
            placeholder="Find a setting: overtime, rent, PIN…"
            aria-label="Find a setting"
            enterKeyHint="go"
            className="h-12 w-full rounded-xl border border-border-strong bg-surface pr-10 pl-10 text-base text-ink placeholder:text-muted/80 focus:border-ink-2 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ink)_7%,transparent)] focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {q && (
            <button type="button" onClick={() => { setQ(""); input.current?.focus(); }} aria-label="Clear search" className="absolute top-1/2 right-1.5 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-muted hover:text-ink">
              <X className="size-4" />
            </button>
          )}
        </div>
      </HelpZone>

      {q.trim() ? (
        <section aria-live="polite">
          <div className="mb-2.5 px-1 text-sm text-muted">{results.length ? `${results.length} setting${results.length === 1 ? "" : "s"}` : `Nothing matches "${q.trim()}".`}</div>
          {results.length > 0 ? (
            <div className="divide-y divide-border rounded-xl border border-border bg-surface">
              {results.map((it) => <Row key={it.id} item={it} value={values[it.id]} waiting={suggestions[it.id]} showSection />)}
            </div>
          ) : (
            <p className="px-1 text-sm text-muted">Try a simpler word, or <Link href="/help" className="text-ink underline-offset-2 hover:underline">search the help center</Link>.</p>
          )}
        </section>
      ) : (
        SECTIONS.map((s) => {
          const items = ITEMS.filter((i) => i.section === s.id);
          return (
            <section key={s.id} id={s.id} className="mb-8 scroll-mt-24">
              <div className="mb-2.5 px-1">
                <h2 className="text-[0.95rem] font-semibold text-ink">{s.title}</h2>
                <p className="mt-0.5 text-sm text-muted">{s.blurb}</p>
              </div>
              <div className={cn("divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface")}>
                {items.map((it) => <Row key={it.id} item={it} value={values[it.id]} waiting={suggestions[it.id]} />)}
              </div>
            </section>
          );
        })
      )}
      <p className="mt-2 px-1 text-xs text-muted">Every setting saves as you change it. <HelpTip id="settings.page" /></p>
    </>
  );
}
