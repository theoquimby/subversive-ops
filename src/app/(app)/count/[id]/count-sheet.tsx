"use client";

import { Button, Card, cx, Input, Select } from "@/components/ui";
import { BaseUnit, CustomConversion, toBase } from "@/domain/units";
import { Check, CloudOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { newClientId, useOffline } from "@/lib/offline-queue";
import { useToast } from "@/components/toast";
import { countQueue } from "../queue";
import { matchScore, normalize } from "@/domain/dataTable";
import { useConfirm } from "@/components/dialog";
import { discardCount, finishCount } from "../actions";
import { HelpTip, HelpZone } from "@/components/help";

interface Item { id: string; name: string; area: string; category: string; base: BaseUnit; units: string[]; conversions: CustomConversion[]; savedBase: number | null }

/** Show a saved base quantity back in the row's unit, e.g. 13608 g → 1 (case). */
const fromBase = (base: number, unit: string, item: Item) => {
  try {
    return Number((base / toBase(1, unit, item.base, item.conversions)).toFixed(2));
  } catch {
    return base;
  }
};

export function CountSheet({ countId, items }: { countId: string; items: Item[] }) {
  const [filter, setFilter] = useState("");
  const [onlyLeft, setOnlyLeft] = useState(false);
  const [units, setUnits] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, i.units[0]])));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.filter((i) => i.savedBase != null).map((i) => [i.id, String(fromBase(i.savedBase!, i.units[0], i))])),
  );
  const [status, setStatus] = useState<Record<string, "saving" | "saved" | "queued" | "error">>(() => Object.fromEntries(items.filter((i) => i.savedBase != null).map((i) => [i.id, "saved"])));
  const [finishing, start] = useTransition();
  const confirm = useConfirm();
  // Saves fire on blur; tapping "Finish" blurs the last field, so wait for in-flight saves first.
  const inFlight = useRef(new Set<Promise<unknown>>());
  const [toast, show] = useToast();
  const offline = useOffline();
  // Lines waiting for signal on this phone (the walk-in). They count as counted.
  const queue = countQueue.useQueue((failed) => show(failed[0], "bad")).filter((q) => q.countId === countId);
  const waiting = queue.length;

  // Coming back to a count: show what this phone still has to send.
  useEffect(() => {
    const mine = countQueue.read().filter((q) => q.countId === countId);
    if (!mine.length) return;
    setValues((v) => ({ ...v, ...Object.fromEntries(mine.map((q) => [q.ingredientId, q.qty == null ? "" : String(q.qty)])) }));
    setUnits((u) => ({ ...u, ...Object.fromEntries(mine.map((q) => [q.ingredientId, q.unit])) }));
    setStatus((st) => ({ ...st, ...Object.fromEntries(mine.filter((q) => q.qty != null).map((q) => [q.ingredientId, "queued" as const])) }));
  }, [countId]);
  // Sent once the signal came back: queued → saved.
  const queuedIds = queue.map((q) => q.ingredientId).join(",");
  useEffect(() => {
    const still = new Set(queuedIds.split(","));
    setStatus((st) => {
      let changed = false;
      const next = { ...st };
      for (const [id, v] of Object.entries(st)) if (v === "queued" && !still.has(id)) { next[id] = "saved"; changed = true; }
      return changed ? next : st;
    });
  }, [queuedIds]);

  const save = async (item: Item, raw: string, unit: string) => {
    const n = raw.trim() === "" ? null : Number(raw);
    if (n != null && (!Number.isFinite(n) || n < 0)) {
      setStatus((s) => ({ ...s, [item.id]: "error" }));
      show(`${item.name}: enter a number, like 2 or 1.5.`, "bad");
      return;
    }
    // Unchanged since the last save: nothing to send.
    if (n == null && status[item.id] == null) return;
    setStatus((s) => ({ ...s, [item.id]: "saving" }));
    const p = countQueue.send({ clientId: newClientId(), label: item.name, countId, ingredientId: item.id, qty: n, unit });
    inFlight.current.add(p);
    const res = await p.finally(() => inFlight.current.delete(p));
    setStatus((s) => {
      const next = { ...s };
      if ("error" in res) next[item.id] = "error";
      else if (n == null) delete next[item.id];
      else next[item.id] = res.queued ? "queued" : "saved";
      return next;
    });
    if ("error" in res) show(`${item.name}: ${res.error}`, "bad");
  };

  const finish = () =>
    start(async () => {
      await Promise.all(inFlight.current);
      if (countQueue.read().some((q) => q.countId === countId)) {
        await countQueue.flush();
        const left = countQueue.read().filter((q) => q.countId === countId).length;
        if (left) {
          show(`${left} line${left === 1 ? " is" : "s are"} still on this phone. Finish once you have signal.`, "queued");
          return;
        }
      }
      await finishCount(countId);
    });

  const isDone = (id: string) => status[id] === "saved" || status[id] === "queued" || status[id] === "saving";
  const groups = useMemo(() => {
    const f = filter.trim();
    // Hide counted items only once you've left them, so a row doesn't vanish while you type in it.
    const list = items.filter((i) => (!f || matchScore(f, normalize(`${i.name} ${i.category}`)) != null) && (!onlyLeft || !isDone(i.id) || document.activeElement?.getAttribute("aria-label") === `${i.name} quantity`));
    return Map.groupBy(list, (i) => i.area);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, filter, onlyLeft, onlyLeft ? status : null]);
  const done = Object.values(status).filter((s) => s === "saved" || s === "queued" || s === "saving").length;
  const areas = useMemo(() => {
    const m = new Map<string, { total: number; left: number }>();
    for (const i of items) {
      const a = m.get(i.area) ?? { total: 0, left: 0 };
      a.total++;
      if (!isDone(i.id)) a.left++;
      m.set(i.area, a);
    }
    return [...m];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, status]);
  const jump = (area: string) => document.getElementById(`area-${area}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="pb-28">
      {toast}
      <div className="sticky top-[calc(3.25rem+env(safe-area-inset-top))] z-10 -mx-4 bg-bg/95 px-4 pb-3 backdrop-blur lg:top-0 lg:pt-2">
        {(offline || waiting > 0) && (
          <p className="mb-2 flex items-center gap-2 rounded-xl bg-warn-bg px-3 py-2.5 text-sm font-medium text-warn" role="status">
            <CloudOff className="size-4 shrink-0" aria-hidden />
            {offline ? "No signal. Keep counting — it's saved on this phone." : `${waiting} line${waiting === 1 ? "" : "s"} waiting to send. They go as soon as there's signal.`}
          </p>
        )}
        <HelpZone id="count.find"><Input type="search" placeholder="Find an item" aria-label="Find an item" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-11 text-base" /></HelpZone>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} aria-label="Counted so far">
          <div className="h-full rounded-full bg-good transition-[width] duration-300" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
        </div>
        <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
          <button type="button" aria-pressed={onlyLeft} onClick={() => setOnlyLeft((v) => !v)}
            className={cx("h-9 shrink-0 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors", onlyLeft ? "border-ink bg-ink text-surface" : "border-border text-ink-2")}>
            Not counted yet
          </button>
          {areas.length > 1 && areas.map(([area, a]) => (
            <button key={area} type="button" onClick={() => jump(area)} className="h-9 shrink-0 rounded-full border border-border px-3 text-sm whitespace-nowrap text-ink-2 hover:border-border-strong">
              {area} <span className={cx("num ml-1", a.left === 0 ? "text-good" : "text-muted")}>{a.left === 0 ? "✓" : a.left}</span>
            </button>
          ))}
        </div>
      </div>
      {onlyLeft && done === items.length && <Card className="mb-6 p-5 text-center text-sm text-good">Everything is counted. Press Finish count.</Card>}
      {[...groups].map(([area, list]) => (
        <HelpZone key={area} id="count.area" className="mb-6"><section id={`area-${area}`} className="scroll-mt-44">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{area}</h2>
          <Card className="divide-y divide-border">
            {list.map((item) => (
              <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium leading-tight">{item.name}</div>
                  <div className="text-xs text-muted">{item.category}</div>
                </div>
                <span
                  role="img"
                  aria-label={status[item.id] === "saved" ? "Saved" : status[item.id] === "queued" ? "Saved on this phone, sends when there's signal" : status[item.id] === "error" ? "Not saved" : status[item.id] === "saving" ? "Saving" : "Not counted"}
                  className={cx("grid size-5 shrink-0 place-items-center rounded-full transition-colors duration-180", status[item.id] === "saved" ? "bg-good text-white" : status[item.id] === "queued" ? "bg-warn-bg text-warn" : status[item.id] === "saving" ? "bg-good/25 text-good" : status[item.id] === "error" ? "bg-bad" : "bg-transparent")}
                >
                  {(status[item.id] === "saved" || status[item.id] === "saving") && <Check className="size-3 animate-pop motion-reduce:animate-none" strokeWidth={3} />}
                  {status[item.id] === "queued" && <CloudOff className="size-3" strokeWidth={2.5} />}
                </span>
                <Input
                  type="number" inputMode="decimal" step="any" min={0}
                  value={values[item.id] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [item.id]: e.target.value }))}
                  onBlur={(e) => save(item, e.target.value, units[item.id])}
                  enterKeyHint="next"
                  data-count-input
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const all = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-count-input]"));
                    const next = all[all.indexOf(e.currentTarget) + 1];
                    if (next) { next.focus(); next.scrollIntoView({ block: "center", behavior: "smooth" }); } else e.currentTarget.blur();
                  }}
                  className="num h-11 w-20 text-right text-base"
                  aria-label={`${item.name} quantity`}
                />
                <Select
                  value={units[item.id]}
                  options={item.units.map((u) => ({ value: u, label: u }))}
                  onChange={(e) => { setUnits((u) => ({ ...u, [item.id]: e.target.value })); if (values[item.id]) save(item, values[item.id], e.target.value); }}
                  className="!h-11 !w-24"
                  aria-label={`${item.name} unit`}
                />
              </div>
            ))}
          </Card>
        </section></HelpZone>
      ))}
      <div className="fixed inset-x-0 bottom-[var(--tabbar)] z-30 border-t border-border bg-surface/95 backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-3">
          <HelpZone id="count.autosave" className="num flex items-center gap-1.5 text-sm text-muted">{done} of {items.length} counted <HelpTip id="count.autosave" placement="top-start" /></HelpZone>
          <div className="flex gap-2">
            <HelpZone id="count.discard"><Button variant="ghost" size="lg" disabled={finishing} onClick={async () => { if (await confirm({ title: "Discard this count?", body: "Everything counted so far will be thrown away.", confirmLabel: "Discard", danger: true })) start(() => discardCount(countId)); }}>Discard</Button></HelpZone>
            <HelpZone id="count.finish"><Button variant="primary" size="lg" disabled={finishing || done === 0} onClick={finish}>{finishing ? "Saving…" : "Finish count"}</Button></HelpZone>
          </div>
        </div>
      </div>
    </div>
  );
}
