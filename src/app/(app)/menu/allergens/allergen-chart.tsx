"use client";

import { Card, cx, EmptyState, Button } from "@/components/ui";
import { ALLERGENS } from "@/domain/allergens";
import { matchScore, normalize } from "@/domain/dataTable";
import { Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

export interface AllergenRow {
  id: string;
  name: string;
  category: string;
  allergens: string[];
  sources: Record<string, string[]>;
}

/**
 * The chart with a search box and "free from" filters (tap Gluten to see everything
 * without gluten). Plain markup, so it prints as one sheet. Filters live in the URL.
 */
export function AllergenChart({ rows }: { rows: AllergenRow[] }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [free, setFree] = useState<string[]>(() => (params.get("free") ?? "").split(",").filter((a) => ALLERGENS.some((x) => x.id === a)));
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const next = new URLSearchParams(window.location.search);
    if (q.trim()) next.set("q", q.trim()); else next.delete("q");
    if (free.length) next.set("free", free.join(",")); else next.delete("free");
    const qs = next.toString();
    window.history.replaceState(window.history.state, "", `${pathname}${qs ? `?${qs}` : ""}`);
  }, [q, free, pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(t.tagName) && !t.isContentEditable) { e.preventDefault(); e.stopPropagation(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  const indexed = useMemo(() => rows.map((r) => ({ r, text: normalize(`${r.name} ${r.category}`) })), [rows]);
  const shown = indexed.filter(({ r, text }) => free.every((a) => !r.allergens.includes(a)) && (!q.trim() || matchScore(q, text) != null)).map((x) => x.r);
  const categories = [...new Set(shown.map((r) => r.category))];
  const toggle = (a: string) => setFree((f) => (f.includes(a) ? f.filter((x) => x !== a) : [...f, a]));
  const label = (id: string) => ALLERGENS.find((x) => x.id === id)!;

  return (
    <>
      <div className="mb-4 space-y-3 print:hidden">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input ref={searchRef} type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQ("")} placeholder="Search menu items" aria-label="Search menu items" className="h-10 w-full rounded-lg border border-border-strong bg-surface pr-20 pl-9 text-base outline-none focus:border-ink-2 sm:h-9 sm:text-sm [&::-webkit-search-cancel-button]:hidden" />
          <span className="num pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">{shown.length === rows.length ? rows.length : `${shown.length} of ${rows.length}`}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Free from">
          <span className="mr-1 text-sm text-muted">Free from</span>
          {ALLERGENS.map((a) => {
            const on = free.includes(a.id);
            return (
              <button key={a.id} type="button" aria-pressed={on} onClick={() => toggle(a.id)} className={cx("h-10 rounded-full border px-3 text-sm transition-colors duration-120 sm:h-8", on ? "border-ink bg-primary text-primary-ink" : "border-border-strong text-ink-2 hover:bg-surface-2")}>
                {a.label}
              </button>
            );
          })}
          {(free.length > 0 || q) && <button type="button" onClick={() => { setFree([]); setQ(""); }} className="inline-flex h-10 items-center gap-1 rounded-lg px-2 text-sm text-muted hover:text-ink sm:h-8"><X className="size-3.5" />Clear</button>}
        </div>
      </div>
      {free.length > 0 && <p className="mb-3 hidden text-sm print:block">Showing items without {free.map((a) => label(a).label.toLowerCase()).join(", ")}.</p>}

      {shown.length === 0 ? (
        <EmptyState title="Nothing matches" action={<Button onClick={() => { setFree([]); setQ(""); }}>Clear filters</Button>}>
          {free.length ? `No menu item is tagged free from ${free.map((a) => label(a).label.toLowerCase()).join(" and ")}.` : "Try another search."}
        </EmptyState>
      ) : (
        <>
          {/* Phones: one card per item listing what it contains. */}
          <div className="space-y-6 sm:hidden print:hidden">
            {categories.map((c) => (
              <section key={c}>
                <h2 className="mb-2 text-sm font-semibold">{c}</h2>
                <Card className="divide-y divide-border">
                  {shown.filter((r) => r.category === c).map((r) => (
                    <Link key={r.id} href={`/menu/${r.id}`} className="block px-4 py-3">
                      <div className="text-sm font-medium">{r.name}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {r.allergens.length === 0 ? <span className="text-xs text-muted">None tagged</span> : r.allergens.map((a) => <span key={a} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-ink-2">{label(a).short}</span>)}
                      </div>
                    </Link>
                  ))}
                </Card>
              </section>
            ))}
          </div>
          {/* Wider screens and paper: the matrix, header and first column sticky. */}
          <Card className="hidden overflow-auto sm:block print:block print:max-h-none print:overflow-visible print:border-0 sm:max-h-[calc(100dvh-8rem)]">
            <table data-no-resize className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky top-0 left-0 z-20 border-b border-border bg-surface px-4 py-2.5 text-left text-[0.75rem] font-medium text-muted">Item</th>
                  {ALLERGENS.map((a) => (
                    <th key={a.id} className={cx("sticky top-0 z-10 border-b border-border bg-surface px-2 py-2.5 text-center text-[0.75rem] font-medium whitespace-nowrap", free.includes(a.id) ? "text-ink" : "text-muted")} title={a.label}>{a.short}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <Fragment key={c}>
                    <tr>
                      <td className="sticky left-0 border-b border-border bg-surface-2 px-4 py-1.5 text-xs font-semibold text-ink-2">{c}</td>
                      <td colSpan={ALLERGENS.length} className="border-b border-border bg-surface-2" />
                    </tr>
                    {shown.filter((r) => r.category === c).map((r) => (
                      <tr key={r.id} className="group print:break-inside-avoid">
                        <td className="sticky left-0 border-b border-border bg-surface px-4 py-2 group-hover:bg-surface-2">
                          <Link href={`/menu/${r.id}`} className="hover:underline">{r.name}</Link>
                        </td>
                        {ALLERGENS.map((a) => {
                          const has = r.allergens.includes(a.id);
                          return (
                            <td key={a.id} className={cx("border-b border-border px-2 py-2 text-center group-hover:bg-surface-2/60", has && "font-semibold")} title={has ? `${a.label}: ${(r.sources[a.id] ?? []).join(", ")}` : undefined}>
                              {has ? <span aria-label={`Contains ${a.label}`}>●</span> : <span className="text-border-strong" aria-hidden>·</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
