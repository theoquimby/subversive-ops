"use client";

import { Button, Card, cx, Input, Select } from "@/components/ui";
import { BaseUnit, CustomConversion, toBase } from "@/domain/units";
import { Check } from "lucide-react";
import { useMemo, useRef, useState, useTransition } from "react";
import { useConfirm } from "@/components/dialog";
import { discardCount, finishCount, saveCountLine } from "../actions";
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
  const [units, setUnits] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, i.units[0]])));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.filter((i) => i.savedBase != null).map((i) => [i.id, String(fromBase(i.savedBase!, i.units[0], i))])),
  );
  const [status, setStatus] = useState<Record<string, "saving" | "saved" | "error">>(() => Object.fromEntries(items.filter((i) => i.savedBase != null).map((i) => [i.id, "saved"])));
  const [finishing, start] = useTransition();
  const confirm = useConfirm();
  // Saves fire on blur; tapping "Finish" blurs the last field, so wait for in-flight saves first.
  const inFlight = useRef(new Set<Promise<unknown>>());

  const save = async (item: Item, raw: string, unit: string) => {
    setStatus((s) => ({ ...s, [item.id]: "saving" }));
    const n = raw.trim() === "" ? null : Number(raw);
    const p = saveCountLine(countId, item.id, n, unit);
    inFlight.current.add(p);
    const res = await p.finally(() => inFlight.current.delete(p));
    setStatus((s) => {
      const next = { ...s };
      if (res.error) next[item.id] = "error";
      else if (n == null) delete next[item.id];
      else next[item.id] = "saved";
      return next;
    });
  };

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = items.filter((i) => !f || i.name.toLowerCase().includes(f));
    return Map.groupBy(list, (i) => i.area);
  }, [items, filter]);
  const done = Object.values(status).filter((s) => s === "saved").length;

  return (
    <div className="pb-28">
      <div className="sticky top-[calc(3.25rem+env(safe-area-inset-top))] z-10 -mx-4 bg-bg/95 px-4 pb-3 backdrop-blur lg:top-0 lg:pt-2">
        <HelpZone id="count.find"><Input type="search" placeholder="Find an item" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-11 text-base" /></HelpZone>
      </div>
      {[...groups].map(([area, list]) => (
        <HelpZone key={area} id="count.area" className="mb-6"><section>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{area}</h2>
          <Card className="divide-y divide-border">
            {list.map((item) => (
              <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium leading-tight">{item.name}</div>
                  <div className="text-xs text-muted">{item.category}</div>
                </div>
                <span className={cx("grid size-5 place-items-center rounded-full", status[item.id] === "saved" ? "bg-good text-white" : status[item.id] === "error" ? "bg-bad" : "bg-transparent")}>
                  {status[item.id] === "saved" && <Check className="size-3" strokeWidth={3} />}
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
            <HelpZone id="count.discard"><Button variant="ghost" disabled={finishing} onClick={async () => { if (await confirm({ title: "Discard this count?", body: "Everything counted so far will be thrown away.", confirmLabel: "Discard", danger: true })) start(() => discardCount(countId)); }}>Discard</Button></HelpZone>
            <HelpZone id="count.finish"><Button variant="primary" size="lg" disabled={finishing || done === 0} onClick={() => start(async () => { await Promise.all(inFlight.current); await finishCount(countId); })}>{finishing ? "Saving…" : "Finish count"}</Button></HelpZone>
          </div>
        </div>
      </div>
    </div>
  );
}
