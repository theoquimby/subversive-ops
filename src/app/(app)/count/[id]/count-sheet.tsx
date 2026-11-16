"use client";

/**
 * The count sheet. Count what you see where you see it:
 *  - each item is listed in its home areas (Frank's: full ones on the dry
 *    shelf, open ones in the walk-in) and saved per area; the line's total is
 *    every place added up;
 *  - "Found something here?" adds any item to this area for this count only;
 *  - every item due needs a total before the count can be sent: counted in at
 *    least one place, or "None anywhere". No zeros needed in its other places;
 *  - before sending, items counted in two or more places are shown with their
 *    breakdown and checked against what we expected, to catch double counts.
 */

import { Button, Card, cx, Input, Select } from "@/components/ui";
import { toBase } from "@/domain/units";
import { describeParts, sumParts, tidyParts, type CountPart } from "@/domain/countUnits";
import { countProgress, partsByArea, totalCheck, type AreaPart } from "@/domain/countPlan";
import { Check, CloudOff, MessageSquareText, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { newClientId, useOffline } from "@/lib/offline-queue";
import { useToast } from "@/components/toast";
import { countQueue } from "../queue";
import { matchScore, normalize } from "@/domain/dataTable";
import { useConfirm } from "@/components/dialog";
import { discardCount, finishCount } from "../actions";
import { HelpTip, HelpZone } from "@/components/help";
import type { CountItem } from "@/server/services/counts";
import { inUnit, ItemSheet, packLine, realSku, Sheet } from "../item-sheet";
import { shortDate } from "@/lib/format";
import { TellManager } from "../tell-manager";

export type SheetItem = CountItem & { saved: { total: number; parts: AreaPart[] | null } | null };
type Entry = { qty: string; unit: string };
type St = "saving" | "saved" | "queued" | "error";
type Row = { key: string; item: CountItem; area: string; home: boolean };

const MIX = "__mix";
const NEW_UNIT = "__new";
const FRACTIONS: [string, number][] = [["¼", 0.25], ["½", 0.5], ["¾", 0.75]];
const rk = (itemId: string, area: string) => `${itemId}|${area}`;
const sig = (parts: CountPart[]) => JSON.stringify(parts);
const one = (i: CountItem) => { try { return toBase(1, i.units[0], i.base, i.conversions); } catch { return 0; } };
const num = (e: Entry[]) => tidyParts(e.map((x) => ({ qty: x.qty.trim() === "" ? null : Number(x.qty), unit: x.unit })));
const total = (i: CountItem, parts: CountPart[]) => { try { return sumParts(parts, i.base, i.conversions); } catch { return null; } };

/** A saved base quantity in the item's first unit: 13608 g → 1 (case). */
const fromBase = (base: number, i: CountItem) => { try { return Number((base / toBase(1, i.units[0], i.base, i.conversions)).toFixed(2)); } catch { return base; } };

export function CountSheet({ countId, countArea, areaOrder, items, catalog, manager }: {
  countId: string;
  /** The area being counted; null for Everything. */
  countArea: string | null;
  areaOrder: string[];
  /** Items listed in this count (due or not). */
  items: SheetItem[];
  /** Every item, for "Found something here?". */
  catalog: CountItem[];
  manager: boolean;
}) {
  const scope = (a: string) => !countArea || a.toLowerCase() === countArea.toLowerCase();
  const byId = useMemo(() => new Map<string, CountItem>([...catalog, ...items].map((i) => [i.id, i])), [catalog, items]);

  // Saved parts per row (what the server has), and the rows they imply.
  const savedRows = useMemo(() => {
    const out: { key: string; itemId: string; area: string; entries: Entry[] }[] = [];
    for (const i of items) {
      if (!i.saved) continue;
      const places = i.saved.parts ? partsByArea(i.saved.parts, i.homeAreas[0]) : [{ area: i.homeAreas.find(scope) ?? i.homeAreas[0], parts: [{ qty: fromBase(i.saved.total, i), unit: i.units[0] }] }];
      for (const p of places) out.push({ key: rk(i.id, p.area), itemId: i.id, area: p.area, entries: p.parts.map((x) => ({ qty: String(x.qty), unit: x.unit })) });
    }
    return out;
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rows added on this phone: "Found something here?" and "Count it anyway".
  const [added, setAdded] = useState<string[]>([]);
  const [entries, setEntries] = useState<Record<string, Entry[]>>(() => Object.fromEntries(savedRows.map((r) => [r.key, r.entries])));
  const [status, setStatus] = useState<Record<string, St>>(() => Object.fromEntries(savedRows.map((r) => [r.key, "saved" as St])));
  const sent = useRef<Record<string, string>>(Object.fromEntries(savedRows.map((r) => [r.key, sig(num(r.entries))])));
  const okd = useRef<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [onlyLeft, setOnlyLeft] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [telling, setTelling] = useState<{ about?: string } | null>(null);
  const [finding, setFinding] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [finishing, start] = useTransition();
  const confirm = useConfirm();
  const inFlight = useRef(new Set<Promise<unknown>>());
  const [toast, show] = useToast();
  const offline = useOffline();
  const queue = countQueue.useQueue((failed) => show(failed[0], "bad")).filter((q) => q.countId === countId);
  const waiting = queue.length;

  // Coming back to a count: show what this phone still has to send.
  useEffect(() => {
    const mine = countQueue.read().filter((q) => q.countId === countId);
    if (!mine.length) return;
    const key = (q: (typeof mine)[number]) => rk(q.ingredientId, q.area ?? byId.get(q.ingredientId)?.area ?? "");
    setAdded((a) => [...new Set([...a, ...mine.map(key)])]);
    setEntries((v) => ({ ...v, ...Object.fromEntries(mine.map((q) => [key(q), q.parts?.length ? q.parts.map((p) => ({ qty: String(p.qty), unit: p.unit })) : [{ qty: q.qty == null ? "" : String(q.qty), unit: q.unit }]])) }));
    setStatus((st) => ({ ...st, ...Object.fromEntries(mine.filter((q) => q.qty != null || q.parts?.length).map((q) => [key(q), "queued" as const])) }));
  }, [countId]); // eslint-disable-line react-hooks/exhaustive-deps
  const queuedKeys = queue.map((q) => rk(q.ingredientId, q.area ?? "")).join(",");
  useEffect(() => {
    const still = new Set(queuedKeys.split(","));
    setStatus((st) => {
      let changed = false;
      const next = { ...st };
      for (const [k, v] of Object.entries(st)) if (v === "queued" && !still.has(k)) { next[k] = "saved"; changed = true; }
      return changed ? next : st;
    });
  }, [queuedKeys]);

  // ---- Rows ----
  const listed = useMemo(() => {
    const keys = new Set([...savedRows.map((r) => r.key), ...added]);
    return items.filter((i) => i.due || i.saved || [...keys].some((k) => k.startsWith(`${i.id}|`)));
  }, [items, savedRows, added]);
  const notDue = items.filter((i) => !listed.includes(i));
  const rows = useMemo(() => {
    const out: Row[] = [];
    const seen = new Set<string>();
    const push = (item: CountItem, area: string, home: boolean) => {
      const k = rk(item.id, area);
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ key: k, item, area, home });
    };
    for (const i of listed) for (const a of i.homeAreas) if (scope(a)) push(i, a, true);
    for (const r of savedRows) { const i = byId.get(r.itemId); if (i) push(i, r.area, i.homeAreas.includes(r.area)); }
    for (const k of added) { const [id, area] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)]; const i = byId.get(id); if (i) push(i, area, i.homeAreas.includes(area)); }
    const rank = new Map(areaOrder.map((a, n) => [a.toLowerCase(), n]));
    const pos = new Map(listed.map((i, n) => [i.id, n]));
    return out.sort((a, b) => (rank.get(a.area.toLowerCase()) ?? 999) - (rank.get(b.area.toLowerCase()) ?? 999) || a.area.localeCompare(b.area) || Number(b.home) - Number(a.home) || (pos.get(a.item.id) ?? 1e6) - (pos.get(b.item.id) ?? 1e6));
  }, [listed, savedRows, added, byId, areaOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  const isRowDone = (k: string) => status[k] === "saved" || status[k] === "queued" || status[k] === "saving";
  const doneRows = (itemId: string) => rows.filter((r) => r.item.id === itemId && isRowDone(r.key) && num(entries[r.key] ?? []).length > 0);
  const itemTotal = (i: CountItem, override?: { key: string; parts: CountPart[] }) => {
    let t = 0;
    for (const r of rows.filter((x) => x.item.id === i.id)) {
      const p = override?.key === r.key ? override.parts : isRowDone(r.key) ? num(entries[r.key] ?? []) : [];
      t += total(i, p) ?? 0;
    }
    return t;
  };

  // Every item due needs a total: counted somewhere, or None.
  const required = listed;
  const counted = useMemo(() => new Set(required.filter((i) => doneRows(i.id).length > 0).map((i) => i.id)), [required, rows, status, entries]); // eslint-disable-line react-hooks/exhaustive-deps
  const firstRow = (i: CountItem) => rows.find((r) => r.item.id === i.id && r.home) ?? rows.find((r) => r.item.id === i.id);
  const progress = useMemo(() => countProgress(required.map((i) => ({ id: i.id, area: firstRow(i)?.area ?? i.area })), counted), [required, counted]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Saving ----
  const save = async (row: Row, list: Entry[]) => {
    const { item } = row;
    if (list.some((e) => e.qty.trim() !== "" && (!Number.isFinite(Number(e.qty)) || Number(e.qty) < 0))) {
      setStatus((s) => ({ ...s, [row.key]: "error" }));
      show(`${item.name}: enter a number, like 2 or 1.5.`, "bad");
      return;
    }
    const parts = num(list);
    const k = sig(parts);
    if (parts.length === 0 ? status[row.key] == null : sent.current[row.key] === k && status[row.key] !== "error") return;
    // Guardrail: a total far above what we expected is usually cases typed as each.
    if (parts.length) {
      const t = itemTotal(item, { key: row.key, parts });
      const ref = item.expected ?? item.last?.qtyBase ?? null;
      if (ref && ref > 0 && t / ref > 4 && t - ref > one(item) * 2 && okd.current[row.key] !== k) {
        const ok = await confirm({ title: "Is that right?", body: <>That makes <b className="num">{inUnit(t, item.units[0], item)}</b> of {item.name}. {item.expected != null ? "We expected about" : "The last count was"} <b className="num">{inUnit(ref, item.units[0], item)}</b>.</>, confirmLabel: "Yes, save it" });
        if (!ok) { focusRow(row.key); return; }
        okd.current[row.key] = k;
      }
    }
    setStatus((s) => ({ ...s, [row.key]: "saving" }));
    const p = countQueue.send({ clientId: newClientId(), label: item.name, countId, ingredientId: item.id, qty: parts.length === 1 ? parts[0].qty : null, unit: parts[0]?.unit ?? item.units[0], parts: parts.length > 1 ? parts : null, area: row.area });
    inFlight.current.add(p);
    const res = await p.finally(() => inFlight.current.delete(p));
    if (!("error" in res)) {
      if (parts.length) sent.current[row.key] = k;
      else delete sent.current[row.key];
    }
    setStatus((s) => {
      const next = { ...s };
      if ("error" in res) next[row.key] = "error";
      else if (parts.length === 0) delete next[row.key];
      else next[row.key] = res.queued ? "queued" : "saved";
      return next;
    });
    if ("error" in res) show(`${item.name}: ${res.error}`, "bad");
  };

  const rowEntries = (r: Row): Entry[] => entries[r.key] ?? [{ qty: "", unit: r.item.units[0] }];
  const setRow = (k: string, list: Entry[]) => setEntries((v) => ({ ...v, [k]: list }));
  const pickUnit = (row: Row, idx: number, unit: string) => {
    const list = rowEntries(row);
    if (unit === MIX) {
      const used = new Set(list.map((e) => e.unit));
      setRow(row.key, [...list, { qty: "", unit: row.item.units.find((u) => !used.has(u)) ?? row.item.units[0] }]);
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`input[data-row="${CSS.escape(row.key)}"][data-idx="${list.length}"]`)?.focus());
      return;
    }
    if (unit === NEW_UNIT) { setOpen(row.item.id); return; }
    const next = list.map((e, i) => (i === idx ? { ...e, unit } : e));
    setRow(row.key, next);
    if (next.some((e) => e.qty.trim())) save(row, next);
  };
  const removeEntry = (row: Row, idx: number) => {
    const next = rowEntries(row).filter((_, i) => i !== idx);
    setRow(row.key, next);
    save(row, next);
  };
  const addFraction = (row: Row, idx: number, f: number) => {
    const list = rowEntries(row);
    const cur = Number(list[idx]?.qty || 0);
    const next = list.map((e, i) => (i === idx ? { ...e, qty: String(Number(((Number.isFinite(cur) ? Math.floor(cur) : 0) + f).toFixed(2))) } : e));
    setRow(row.key, next);
    save(row, next);
  };
  const none = (row: Row) => {
    const next = [{ qty: "0", unit: rowEntries(row)[0]?.unit ?? row.item.units[0] }];
    setRow(row.key, next);
    return save(row, next);
  };

  const focusRow = (k: string) => requestAnimationFrame(() => {
    const el = document.querySelector<HTMLInputElement>(`input[data-row="${CSS.escape(k)}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.focus({ preventScroll: true });
  });
  const jumpTo = (itemId: string) => {
    const i = byId.get(itemId);
    const r = i && firstRow(i);
    if (!r) return;
    setFilter("");
    setOnlyLeft(false);
    setChecking(false);
    focusRow(r.key);
  };
  const addRow = (itemId: string, area: string) => {
    const k = rk(itemId, area);
    setAdded((a) => (a.includes(k) ? a : [...a, k]));
    setTimeout(() => focusRow(k), 60);
  };

  // ---- Before you send ----
  const multi = required
    .map((i) => {
      const places = doneRows(i.id).map((r) => ({ area: r.area, parts: num(entries[r.key] ?? []) }));
      const t = itemTotal(i);
      return { i, places, t, check: totalCheck({ total: t, places: places.length, expected: i.expected, last: i.last?.qtyBase ?? null, minGap: one(i) * 2 }) };
    })
    .filter((x) => x.places.length >= 2 || x.check);
  const missing = required.filter((i) => !counted.has(i.id));

  const send = () =>
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
      const r = await finishCount(countId);
      if (r?.error) show(r.error, "bad");
    });
  const finish = () => {
    // Lots left: take them to the next one. A handful: show them all with one-tap fixes.
    if (missing.length > 12) jumpTo(progress.left[0].firstId);
    else if (missing.length || multi.length) setChecking(true);
    else send();
  };

  // ---- Filtering and grouping ----
  const visible = useMemo(() => {
    const f = filter.trim();
    return rows.filter((r) => (!f || matchScore(f, normalize(`${r.item.name} ${r.item.category} ${r.item.packs.map((p) => `${p.sku} ${p.description}`).join(" ")}`)) != null) && (!onlyLeft || !counted.has(r.item.id) || focused === r.key));
  }, [rows, filter, onlyLeft, onlyLeft ? counted : null]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = [...Map.groupBy(visible, (r) => r.area)];
  const areaChips = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.area, (m.get(r.area) ?? 0) + (counted.has(r.item.id) ? 0 : 1));
    return [...m];
  }, [rows, counted]);
  const jumpArea = (area: string) => document.getElementById(`area-${area}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const areasForFind = countArea ? [countArea] : areaOrder;

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
        <HelpZone id="count.find"><Input type="search" placeholder="Find an item or item number" aria-label="Find an item" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-11 text-base" /></HelpZone>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="Counted so far">
          <div className="h-full rounded-full bg-good transition-[width] duration-300" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
        </div>
        <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
          <button type="button" aria-pressed={onlyLeft} onClick={() => setOnlyLeft((v) => !v)}
            className={cx("h-9 shrink-0 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors", onlyLeft ? "border-ink bg-ink text-surface" : "border-border text-ink-2")}>
            Not counted yet
          </button>
          {areaChips.length > 1 && areaChips.map(([area, left]) => (
            <button key={area} type="button" onClick={() => jumpArea(area)} className="h-9 shrink-0 rounded-full border border-border px-3 text-sm whitespace-nowrap text-ink-2 hover:border-border-strong">
              {area} <span className={cx("num ml-1", left === 0 ? "text-good" : "text-muted")}>{left === 0 ? "✓" : left}</span>
            </button>
          ))}
        </div>
      </div>

      {onlyLeft && progress.remaining === 0 && <Card className="mb-6 p-5 text-center text-sm text-good">Everything is counted. Press {manager ? "Finish count" : "Send to manager"}.</Card>}

      {groups.map(([area, list]) => (
        <HelpZone key={area} id="count.area" className="mb-6"><section id={`area-${area}`} className="scroll-mt-44">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{area}</h2>
          <Card className="divide-y divide-border">
            {list.map((row) => {
              const { item } = row;
              const list = rowEntries(row);
              const st = status[row.key];
              const elsewhere = !isRowDone(row.key) && counted.has(item.id) ? doneRows(item.id).map((r) => r.area).filter((a) => a !== row.area) : [];
              const options = [
                ...item.units.map((u) => ({ value: u, label: u, hint: item.unitNotes[u] })),
                ...(item.units.length > 1 ? [{ value: MIX, label: "Add another unit", hint: "e.g. 2 jug + 3 can" }] : []),
                ...(manager ? [{ value: NEW_UNIT, label: "New unit…", hint: "Add one that's missing" }] : []),
              ];
              const places = doneRows(item.id).length;
              return (
                <div key={row.key} className="px-3 py-2.5 sm:px-4">
                  <div className="flex items-center gap-2.5">
                    <button type="button" onClick={() => setOpen(item.id)} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left" aria-label={`About ${item.name}`}>
                      {item.photoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.photoUrl} alt="" loading="lazy" className="size-10 shrink-0 rounded-lg bg-surface-2 object-cover ring-1 ring-border" />
                      )}
                      <span className="min-w-0">
                        <span className="line-clamp-2 block font-medium leading-tight">{item.name}</span>
                        <span className="block truncate text-xs text-muted">{!row.home ? <span className="text-ink-2">Found here this count · </span> : null}{packLine(item)}</span>
                        {item.countNote && <span className="block truncate text-xs text-ink-2">{item.countNote}</span>}
                        {elsewhere.length > 0 && <span className="block truncate text-xs text-good">Counted in {elsewhere.join(", ")}</span>}
                      </span>
                    </button>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {list.map((e, idx) => (
                        <div key={idx} className="relative flex items-center gap-1.5">
                          {idx > 0 && <Button variant="ghost" size="sm" className="size-9 p-0 text-muted" onClick={() => removeEntry(row, idx)} aria-label={`Remove ${e.unit} from ${item.name}`}><X className="size-3.5" /></Button>}
                          <div className="relative">
                            {idx === 0 && (
                              <span role="img"
                                aria-label={st === "saved" ? "Saved" : st === "queued" ? "Saved on this phone, sends when there's signal" : st === "error" ? "Not saved" : st === "saving" ? "Saving" : "Not counted"}
                                className={cx("absolute -top-1.5 -left-1.5 z-[1] grid size-4 place-items-center rounded-full transition-colors duration-180", st === "saved" ? "bg-good text-white" : st === "queued" ? "bg-warn-bg text-warn ring-1 ring-warn/40" : st === "saving" ? "bg-good/25 text-good" : st === "error" ? "bg-bad" : "bg-transparent")}>
                                {(st === "saved" || st === "saving") && <Check className="size-2.5 animate-pop motion-reduce:animate-none" strokeWidth={3.5} />}
                                {st === "queued" && <CloudOff className="size-2.5" strokeWidth={2.5} />}
                              </span>
                            )}
                            <Input
                              type="number" inputMode="decimal" step="any" min={0}
                              value={e.qty}
                              placeholder={elsewhere.length ? "—" : undefined}
                              onChange={(ev) => setRow(row.key, list.map((x, i) => (i === idx ? { ...x, qty: ev.target.value } : x)))}
                              onFocus={() => setFocused(`${row.key}#${idx}`)}
                              onBlur={(ev) => { setFocused((f) => (f === `${row.key}#${idx}` ? null : f)); save(row, list.map((x, i) => (i === idx ? { ...x, qty: ev.target.value } : x))); }}
                              enterKeyHint="next"
                              data-count-input data-row={row.key} data-idx={idx}
                              onKeyDown={(ev) => {
                                if (ev.key !== "Enter") return;
                                ev.preventDefault();
                                const all = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-count-input]"));
                                const next = all[all.indexOf(ev.currentTarget) + 1];
                                if (next) { next.focus(); next.scrollIntoView({ block: "center", behavior: "smooth" }); } else ev.currentTarget.blur();
                              }}
                              className={cx("num h-11 w-[4.5rem] text-right text-base", st === "error" && idx === 0 && "border-bad")}
                              aria-label={idx === 0 ? `${item.name} quantity${row.home ? "" : ` in ${row.area}`}` : `${item.name} quantity ${idx + 1}`}
                            />
                          </div>
                          <Select value={e.unit} options={options} onChange={(ev) => pickUnit(row, idx, ev.target.value)} className="!h-11 !w-[5.75rem]" aria-label={idx === 0 ? `${item.name} unit` : `${item.name} unit ${idx + 1}`} />
                        </div>
                      ))}
                      {list.length > 1 && (() => { const t = total(item, num(list)); return t == null ? null : <span className="num text-xs text-muted">= {inUnit(t, item.units[0], item)}</span>; })()}
                      {places > 1 && isRowDone(row.key) && <span className="num text-xs text-muted">{places} places · {inUnit(itemTotal(item), item.units[0], item)} in all</span>}
                    </div>
                  </div>
                  {focused?.startsWith(`${row.key}#`) && (
                    <div className="mt-2 flex items-center justify-end gap-1.5" aria-label="Quick amounts">
                      {!counted.has(item.id) && !(rowEntries(row)[0]?.qty ?? "").trim() && (
                        <button type="button" onMouseDown={(ev) => ev.preventDefault()} onClick={() => none(row)}
                          className="mr-auto h-9 rounded-full border border-border px-3 text-sm text-ink-2 hover:border-border-strong" aria-label={`None of ${item.name} here`}>None here</button>
                      )}
                      <span className="mr-0.5 text-xs text-muted">Open one?</span>
                      {FRACTIONS.map(([label, f]) => (
                        <button key={label} type="button" onMouseDown={(ev) => ev.preventDefault()} onClick={() => addFraction(row, Number(focused.split("#")[1]), f)}
                          className="num h-9 min-w-11 rounded-full border border-border px-3 text-sm text-ink-2 hover:border-border-strong" aria-label={`Add ${label}`}>+{label}</button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
          <HelpZone id="count.foundHere"><button type="button" onClick={() => setFinding(area)} className="mt-2 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-medium text-ink-2 hover:bg-surface-2/60">
            <Plus className="size-4" aria-hidden /> Found something else in {area}?
          </button></HelpZone>
        </section></HelpZone>
      ))}
      {groups.length === 0 && countArea && !filter.trim() && (
        <Card className="mb-6 p-5 text-center text-sm text-muted">Nothing is listed in {countArea} yet. <button type="button" className="font-medium text-ink underline" onClick={() => setFinding(countArea)}>Add what you find</button>.</Card>
      )}

      {notDue.length > 0 && !filter.trim() && (
        <HelpZone id="count.notDue" className="mb-6"><section>
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Not due this time <span className="num font-normal normal-case">· {notDue.length}</span> <HelpTip id="count.notDue" /></h2>
          <Card className="divide-y divide-border">
            {notDue.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{i.name}</span>
                  <span className="block truncate text-xs text-muted">{i.last ? `${inUnit(i.last.qtyBase, i.units[0], i)} carried from ${shortDate(i.last.at.slice(0, 10))}` : "Not counted yet"} · {i.every === "monthly" ? "monthly" : "when it changes"}</span>
                </span>
                <Button size="sm" variant="ghost" className="h-10 shrink-0" onClick={() => addRow(i.id, i.homeAreas.find(scope) ?? i.area)}>Count it anyway</Button>
              </div>
            ))}
          </Card>
        </section></HelpZone>
      )}

      {progress.remaining > 0 && progress.remaining <= 12 && (
        <HelpZone id="count.left" className="mb-6"><Card className="p-4">
          <div className="text-sm font-medium">{progress.remaining} left before you can {manager ? "finish" : "send it"}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {progress.left.map((a) => (
              <button key={a.area} type="button" onClick={() => jumpTo(a.firstId)} className="h-9 rounded-full border border-border px-3 text-sm text-ink-2 hover:border-border-strong">
                <span className="num">{a.left}</span> left in {a.area}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">An item only needs counting once, wherever you found it. None anywhere? Tap None.</p>
        </Card></HelpZone>
      )}

      {!manager && (
        <HelpZone id="count.tellManager"><button type="button" onClick={() => setTelling({})} className="mb-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong px-4 text-sm text-ink-2 hover:bg-surface-2/60">
          <MessageSquareText className="size-4" aria-hidden /> Something wrong or missing? Tell the manager
        </button></HelpZone>
      )}

      {open && (() => { const it = byId.get(open); return it ? <ItemSheet item={it} manager={manager} onClose={() => setOpen(null)} onTellManager={() => { setOpen(null); setTelling({ about: it.name }); }} /> : null; })()}
      {telling && <TellManager countId={countId} about={telling.about} onClose={() => setTelling(null)} onSent={() => { setTelling(null); show("Sent to the manager.", "good"); }} />}
      {finding && <FindSheet area={finding} areas={areasForFind} catalog={catalog} listed={new Set(rows.filter((r) => r.area === finding).map((r) => r.item.id))} onPick={(id, area) => { setFinding(null); addRow(id, area); }} onClose={() => setFinding(null)} onTellManager={manager ? undefined : () => { setFinding(null); setTelling({}); }} />}
      {checking && (
        <Sheet title={missing.length ? `${missing.length} item${missing.length === 1 ? "" : "s"} still need a number` : "Before you send"} label="Check the count" onClose={() => setChecking(false)}>
          <HelpZone id="count.check" className="space-y-5 pb-2">
            {missing.length > 0 && (
              <section>
                <p className="mb-2 text-sm text-muted">Count each one wherever you saw it, or mark it None anywhere.</p>
                <Card className="divide-y divide-border">
                  {missing.map((i) => (
                    <div key={i.id} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
                      <span className="min-w-0"><span className="block truncate font-medium">{i.name}</span><span className="block truncate text-xs text-muted">{i.homeAreas.filter(scope).join(", ") || i.area}</span></span>
                      <span className="flex shrink-0 gap-1">
                        <Button size="sm" variant="ghost" className="h-10" onClick={() => jumpTo(i.id)}>Count</Button>
                        <Button size="sm" className="h-10" onClick={() => { const r = firstRow(i); if (r) none(r); }}>None anywhere</Button>
                      </span>
                    </div>
                  ))}
                </Card>
              </section>
            )}
            {missing.length === 0 && multi.length > 0 && (
              <section>
                <p className="mb-2 text-sm text-muted">Counted in more than one place, or far from what we expected. Check nothing was counted twice.</p>
                <Card className="divide-y divide-border">
                  {multi.map(({ i, places, t, check }) => (
                    <div key={i.id} className={cx("px-3 py-2.5 text-sm", check && "bg-warn-bg/60")}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 font-medium">{i.name}</span>
                        <span className="num shrink-0 font-medium">{inUnit(t, i.units[0], i)}</span>
                      </div>
                      {places.length > 1 && <div className="num mt-0.5 text-xs text-ink-2">{places.map((p) => `${p.area} ${describeParts(p.parts)}`).join(" · ")}</div>}
                      {check && (
                        <div className="mt-1 text-xs text-warn">
                          {check.kind === "double" ? `Counted in ${places.length} places, ${check.ratio.toFixed(1)}× what we expected. Check you didn't count the same one twice.`
                            : check.kind === "high" ? `${check.ratio.toFixed(1)}× what we expected (${inUnit(i.expected ?? i.last?.qtyBase ?? 0, i.units[0], i)}).`
                            : `Much less than expected (${inUnit(i.expected ?? i.last?.qtyBase ?? 0, i.units[0], i)}).`}
                        </div>
                      )}
                      <Button size="sm" variant="ghost" className="mt-1 h-9 px-2 text-xs" onClick={() => jumpTo(i.id)}>Fix</Button>
                    </div>
                  ))}
                </Card>
              </section>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setChecking(false)}>Keep counting</Button>
              {missing.length === 0 && <Button variant="primary" disabled={finishing} onClick={() => { setChecking(false); send(); }}>{finishing ? "Saving…" : manager ? "Looks right, finish" : "Looks right, send"}</Button>}
            </div>
          </HelpZone>
        </Sheet>
      )}

      <div className="fixed inset-x-0 bottom-[var(--tabbar)] z-30 border-t border-border bg-surface/95 backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-3">
          <HelpZone id="count.autosave" className="num flex items-center gap-1.5 text-sm text-muted">{progress.done} of {progress.total} <HelpTip id="count.autosave" placement="top-start" /></HelpZone>
          <div className="flex gap-2">
            <HelpZone id="count.discard"><Button variant="ghost" size="lg" disabled={finishing} onClick={async () => { if (await confirm({ title: "Discard this count?", body: "Everything counted so far will be thrown away.", confirmLabel: "Discard", danger: true })) start(() => discardCount(countId)); }}>Discard</Button></HelpZone>
            <HelpZone id="count.finish"><Button variant="primary" size="lg" disabled={finishing || progress.total === 0} onClick={finish}>{finishing ? "Saving…" : progress.remaining > 0 ? `${progress.remaining} left` : manager ? "Finish count" : "Send to manager"}</Button></HelpZone>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Found something here?": add any item to this area, for this count only. */
function FindSheet({ area, areas, catalog, listed, onPick, onClose, onTellManager }: { area: string; areas: string[]; catalog: CountItem[]; listed: Set<string>; onPick: (id: string, area: string) => void; onClose: () => void; onTellManager?: () => void }) {
  const [q, setQ] = useState("");
  const [where, setWhere] = useState(area);
  const results = useMemo(() => {
    const f = q.trim();
    const list = catalog.filter((i) => !listed.has(i.id));
    if (!f) return list.slice(0, 40);
    return list
      .map((i) => ({ i, s: matchScore(f, normalize(`${i.name} ${i.category} ${i.packs.map((p) => `${p.sku} ${p.description}`).join(" ")}`)) }))
      .filter((x) => x.s != null)
      .sort((a, b) => b.s! - a.s!)
      .slice(0, 40)
      .map((x) => x.i);
  }, [q, catalog, listed]);
  return (
    <Sheet title={`Found something in ${where}?`} label="Add an item to this area" onClose={onClose}>
      <div className="space-y-3 pb-2">
        <p className="text-sm text-muted">Add it here for this count. Its usual place doesn&apos;t change.</p>
        {areas.length > 1 && <Select value={where} options={areas.map((a) => ({ value: a, label: a }))} onChange={(e) => setWhere(e.target.value)} className="!h-10 w-full" aria-label="Where you found it" />}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or item number" className="h-11 pl-9 text-base" aria-label="Search items" />
        </div>
        <ul className="divide-y divide-border rounded-xl ring-1 ring-border">
          {results.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted">Nothing matches.</li>}
          {results.map((i) => {
            const sku = i.packs.find((p) => realSku(p.sku))?.sku;
            return (
              <li key={i.id}>
                <button type="button" onClick={() => onPick(i.id, where)} className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2/60">
                  {i.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={i.photoUrl} alt="" loading="lazy" className="size-10 shrink-0 rounded-lg bg-surface-2 object-cover ring-1 ring-border" />
                  ) : <span className="size-10 shrink-0 rounded-lg bg-surface-2" aria-hidden />}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{i.name}</span>
                    <span className="block truncate text-xs text-muted">Usually in {i.homeAreas.join(", ")}{sku ? ` · #${sku}` : ""}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {onTellManager && <Button variant="ghost" className="h-11 w-full" onClick={onTellManager}>Not on the list? Tell the manager</Button>}
      </div>
    </Sheet>
  );
}
