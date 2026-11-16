"use client";

import { HelpTip } from "@/components/help";
import { Button, cx, EmptyState, Section } from "@/components/ui";
import { matchScore, normalize } from "@/domain/dataTable";
import { moreLabel, shownCount } from "@/domain/lists";
import { ChevronDown, Search, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";

export interface DemandItem {
  id: string;
  name: string;
  /** Full kegs or one on tap. */
  inStock: boolean;
  /** Sold any pints in the last four weeks. */
  soldLately: boolean;
  /** The card, rendered on the server. */
  card: ReactNode;
}

export interface DemandGroup {
  key: "core" | "rotation" | "retired";
  title: string;
  description: string;
  help?: string;
  /** Cards shown before "Show N more"; everything when searching. */
  limit: number;
  items: DemandItem[];
  /** Shown when the group has no beers at all. */
  empty?: ReactNode;
}

type Only = "" | "stock" | "sold";

/**
 * The demand cards with tools for a long list: a search, "in stock" and "sold
 * lately", long groups cut short with "Show N more", and retired beers behind
 * "Show retired" (kept in the address as ?retired=1).
 */
export function DemandBrowser({ groups, showRetired: initialRetired }: { groups: DemandGroup[]; showRetired: boolean }) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<Only>("");
  const [showRetired, setShowRetired] = useState(initialRetired);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const u = new URL(window.location.href);
    if (showRetired) u.searchParams.set("retired", "1");
    else u.searchParams.delete("retired");
    if (u.href !== window.location.href) window.history.replaceState(window.history.state, "", u.href);
  }, [showRetired]);

  const searching = !!q.trim();
  const shown = useMemo(
    () =>
      groups.map((g) => ({
        ...g,
        items: g.items.filter((i) => (!searching || matchScore(q, normalize(i.name)) != null) && (only === "" || (only === "stock" ? i.inStock : i.soldLately))),
      })),
    [groups, q, only, searching],
  );
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  const matches = shown.reduce((s, g) => s + (g.key === "retired" && !showRetired && !searching ? 0 : g.items.length), 0);
  const retired = groups.find((g) => g.key === "retired");
  const count = (o: Only) => groups.reduce((s, g) => s + (g.key === "retired" && !showRetired ? 0 : g.items.filter((i) => (o === "stock" ? i.inStock : i.soldLately)).length), 0);
  const chip = (o: Only, label: string, n?: number) => (
    <button key={o || "all"} type="button" aria-pressed={only === o} onClick={() => setOnly(o)} className={cx("inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm whitespace-nowrap transition-colors duration-120 sm:h-9", only === o ? "border-ink bg-ink text-bg" : "border-border-strong bg-surface text-ink-2 hover:bg-surface-2")}>
      {label}{n != null && <span className={cx("num text-xs", only === o ? "opacity-80" : "text-muted")}>{n}</span>}
    </button>
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-80 sm:flex-none sm:basis-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }}
            placeholder="Search beers"
            aria-label="Search beers"
            className="h-10 w-full rounded-lg border border-border-strong bg-surface pr-16 pl-9 text-base text-ink placeholder:text-muted/70 focus:border-ink-2 focus:outline-none sm:h-9 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted" aria-live="polite"><span className="num">{searching || only ? `${matches} of ${total}` : total}</span></span>
          {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute top-1/2 right-10 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"><X className="size-3.5" /></button>}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
          {chip("", "Every beer")}
          {chip("stock", "In stock", count("stock"))}
          {chip("sold", "Sold lately", count("sold"))}
        </div>
      </div>

      {matches === 0 && (searching || only) ? (
        <EmptyState title="No beer matches" action={<div className="flex flex-wrap justify-center gap-2">{q && <Button onClick={() => setQ("")}>Clear search “{q}”</Button>}{only && <Button onClick={() => setOnly("")}>Show every beer</Button>}</div>}>
          {retired && !showRetired && !searching ? "Retired beers are hidden; search finds them too." : "Nothing fits this search and filter together."}
        </EmptyState>
      ) : null}

      {shown.map((g) => {
        if (g.key === "retired" && !showRetired && !searching) return null;
        const all = groups.find((x) => x.key === g.key)!.items.length;
        if (!g.items.length) {
          if (g.key === "core" && !searching && !only && g.empty) return <Section key={g.key} help={g.help} title={<GroupTitle g={g} />} description={g.description}>{g.empty}</Section>;
          return null;
        }
        const isOpen = searching || !!open[g.key];
        const first = shownCount(g.items.length, g.limit);
        const hidden = g.items.length - first;
        const list = isOpen ? g.items : g.items.slice(0, first);
        const noun: [string, string] = g.key === "rotation" ? ["beer in rotation", "beers in rotation"] : g.key === "retired" ? ["retired beer", "retired beers"] : ["core beer", "core beers"];
        return (
          <Section
            key={g.key}
            help={g.help}
            title={<GroupTitle g={g} count={g.items.length < all ? `${g.items.length} of ${all}` : String(all)} />}
            description={g.description}
            actions={g.key === "retired" && !searching ? <Button size="sm" className="h-10 sm:h-8" onClick={() => setShowRetired(false)}>Hide retired</Button> : undefined}
          >
            <div className={cx("grid gap-3 lg:grid-cols-2", g.key === "retired" && "opacity-90")}>{list.map((i) => <Fragment key={i.id}>{i.card}</Fragment>)}</div>
            {hidden > 0 && !searching && (
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))} className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm text-muted underline decoration-border-strong underline-offset-4 hover:text-ink">
                <ChevronDown className={cx("size-3.5 transition-transform duration-180", isOpen && "rotate-180")} />
                {isOpen ? "Show fewer" : moreLabel(hidden, noun)}
              </button>
            )}
          </Section>
        );
      })}

      {retired && retired.items.length > 0 && !showRetired && !searching && (
        <p className="-mt-4 mb-10 text-sm text-muted">
          <button type="button" onClick={() => setShowRetired(true)} className="underline decoration-border-strong underline-offset-2 hover:text-ink">Show retired</button> · {retired.items.length} beer{retired.items.length === 1 ? "" : "s"} not brewed any more
        </p>
      )}
    </div>
  );
}

function GroupTitle({ g, count }: { g: DemandGroup; count?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {g.title}
      {count && <span className="num text-sm font-normal text-muted">{count}</span>}
      {g.help && <HelpTip id={g.help} />}
    </span>
  );
}
