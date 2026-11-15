"use client";

import { GridSelect } from "@/components/grid";
import { Badge, Button, Card, cx } from "@/components/ui";
import { displayCode, sinceLabel } from "@/domain/kegs";
import { abvText, BADGE_LABEL, priceText } from "@/domain/taps";
import type { TapList, TapListRow } from "@/server/services/taps";
import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { BeerDot, daysText, LeftBar, pctText, sizeShort } from "../bits";
import { moveTap, resetTapOrder, setAutoComingSoon } from "./actions";

export function TapListView({ rows, free, manager }: { rows: TapListRow[]; free: number[]; manager: boolean }) {
  // Optimistic order while a move saves.
  const [order, setOrder] = useState(rows.map((r) => r.line));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setOrder(rows.map((r) => r.line)), [rows]);
  const byLine = new Map(rows.map((r) => [r.line, r]));
  const ordered = order.map((l) => byLine.get(l)).filter((r): r is TapListRow => !!r);
  const custom = rows.some((r, i) => i > 0 && r.line < rows[i - 1].line);

  const move = (line: number, dir: -1 | 1) => {
    const i = order.indexOf(line);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    setError(null);
    start(async () => {
      const r = await moveTap(line, dir);
      if (r.error) { setError(r.error); setOrder(rows.map((x) => x.line)); }
    });
  };

  return (
    <>
      <Card className="divide-y divide-border">
        {ordered.map((t, i) => (
          <div key={t.kegId} className="flex items-start gap-3 px-3 py-3 sm:px-4">
            <span className="num mt-0.5 grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-2 text-sm font-semibold" title={`Tap ${t.line}`}>
              {t.line}
            </span>
            <Link href={`/kegs/k/${t.kegCode}`} className="min-w-0 flex-1 rounded-md focus-visible:outline-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <BeerDot color={t.color} />
                <span className="min-w-0 truncate font-medium">{t.beer}</span>
                {t.badge && <Badge tone={t.badge === "almost" ? "warn" : "good"}>{BADGE_LABEL[t.badge]}</Badge>}
                {t.overdue && <Badge tone="bad">Should have kicked</Badge>}
              </div>
              <div className="mt-0.5 truncate text-xs text-muted">
                {[t.style, abvText(t.abv), t.ibu != null ? `${t.ibu} IBU` : null, t.diet].filter(Boolean).join(" · ") || <span>No style or ABV yet{manager ? " — add them on Beers" : ""}</span>}
              </div>
              <div className="mt-1.5 max-w-md"><LeftBar pct={t.pctLeft} color={t.color} /></div>
              <div className="num mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                <span className={t.badge === "almost" ? "font-medium text-warn" : ""}>{pctText(t.pctLeft)}</span>
                {daysText(t.daysLeft) && <span>{daysText(t.daysLeft)}</span>}
                {t.tappedAt && <span>on {sinceLabel(new Date(t.tappedAt))}</span>}
                <span className={t.backups === 0 ? "text-bad" : ""}>{t.backups} full behind it</span>
                <span className="hidden sm:inline">{sizeShort(t.sizeId)} · {displayCode(t.kegCode)}</span>
              </div>
              <div className="num mt-1 flex flex-wrap gap-x-3 text-sm">
                {t.pours.length ? t.pours.map((p) => <span key={p.label}><span className="text-muted">{p.label}</span> {priceText(p.price)}</span>) : <span className="text-xs text-muted">No prices{manager ? " — link Square items or type them on Beers" : ""}</span>}
              </div>
              {manager && t.square && (
                <div className={cx("mt-1 text-xs", t.square.tone === "good" ? "text-muted" : t.square.tone === "bad" ? "text-bad" : t.square.tone === "warn" ? "text-warn" : "text-muted")}>
                  Square: {t.square.text}
                </div>
              )}
            </Link>
            {manager && (
              <div className="flex shrink-0 flex-col gap-1">
                <Button size="sm" variant="ghost" className="size-10 p-0 sm:size-8" aria-label={`Move ${t.beer} up the board`} disabled={pending || i === 0} onClick={() => move(t.line, -1)}><ArrowUp className="size-4" /></Button>
                <Button size="sm" variant="ghost" className="size-10 p-0 sm:size-8" aria-label={`Move ${t.beer} down the board`} disabled={pending || i === ordered.length - 1} onClick={() => move(t.line, 1)}><ArrowDown className="size-4" /></Button>
              </div>
            )}
          </div>
        ))}
        {free.length > 0 && (
          <div className="px-4 py-2.5 text-sm text-muted">Free: {free.map((l) => `tap ${l}`).join(", ")}</div>
        )}
      </Card>
      {manager && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>The arrows set the board order; tap numbers stay as they are.</span>
          {custom && (
            <Button size="sm" variant="ghost" className="h-10 sm:h-8" disabled={pending} onClick={() => start(async () => { await resetTapOrder(); })}><RotateCcw className="size-3.5" /> Back to tap order</Button>
          )}
          {error && <span className="text-bad">{error}</span>}
        </div>
      )}
    </>
  );
}

export function ComingSoonList({ items, auto, manager }: { items: TapList["comingSoon"]; auto: boolean; manager: boolean }) {
  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-sm text-muted">Nothing coming soon. {auto ? "Beers show here when a full keg is in cold storage and none is on tap." : ""}</p>
      ) : (
        <Card className="divide-y divide-border">
          {items.map((s) => (
            <div key={s.beerId} className="flex items-center gap-3 px-4 py-2.5">
              <BeerDot color={s.color} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.beer}</div>
                <div className="truncate text-xs text-muted">{[s.style, abvText(s.abv)].filter(Boolean).join(" · ") || " "}</div>
              </div>
              <span className="num shrink-0 text-xs text-muted">{s.pinned ? "Pinned" : `${s.fullKegs} full`}</span>
            </div>
          ))}
        </Card>
      )}
      {manager && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2">
          <span className="min-w-0 flex-1 text-sm">Show beers with a full keg ready</span>
          <div className="w-40"><GridSelect ariaLabel="Show beers with a full keg ready as coming soon" value={auto ? "yes" : "no"} options={[{ value: "yes", label: "Yes" }, { value: "no", label: "Only pinned" }]} onSave={(v) => setAutoComingSoon(v === "yes")} /></div>
        </div>
      )}
    </div>
  );
}
