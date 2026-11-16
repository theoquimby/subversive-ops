"use client";

import { Select } from "@/components/select";
import { Button, Card, cx, DatePicker, Field, Input, Textarea } from "@/components/ui";
import { mergeLines, TRANSITS, validateOrder, type Transit } from "@/domain/kegOrders";
import { KEG_SIZE_LIST } from "@/domain/kegs";
import type { OrderFormContext } from "@/server/services/kegOrders";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { createKegOrder } from "./actions";

const SIZES = KEG_SIZE_LIST.map((s) => ({ value: s.id, label: s.short }));

/** Delivery or pickup, as two buttons. */
export function TransitChoice({ value, onChange }: { value: string; onChange: (t: Transit) => void }) {
  return (
    <div role="group" aria-label="Delivery or pickup" className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
      {TRANSITS.map((t) => (
        <button key={t.value} type="button" aria-pressed={value === t.value} onClick={() => onChange(t.value)} className={cx("h-10 rounded-lg text-sm font-medium transition-colors duration-120 sm:h-8", value === t.value ? "bg-surface text-ink shadow-sm" : "text-ink-2")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

interface Row {
  key: number;
  beerId: string;
  sizeId: string;
  quantity: string;
}

/** The new-order form: account, delivery or pickup, an optional date, and lines of beer × size × how many. */
export function NewOrderForm({ ctx, stock, accountId: startAccount, today }: { ctx: OrderFormContext; stock: { beerId: string; sizeId: string; available: number }[]; accountId: string; today: string }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(startAccount);
  const [transit, setTransit] = useState<Transit>("DELIVERY");
  const [dueOn, setDueOn] = useState("");
  const [rows, setRows] = useState<Row[]>([{ key: 0, beerId: "", sizeId: "half", quantity: "1" }]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const nextKey = useRef(1);

  const patch = (key: number, p: Partial<Row>) => { setError(null); setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...p } : r))); };
  const addRow = () => setRows((cur) => [...cur, { key: nextKey.current++, beerId: "", sizeId: cur[cur.length - 1]?.sizeId ?? "half", quantity: "1" }]);
  const qty = (r: Row) => (/^\d+$/.test(r.quantity.trim()) ? Number(r.quantity.trim()) : Number.NaN);

  /** What this line asks for against the full kegs no open order needs yet. */
  const hint = (r: Row) => {
    if (!r.beerId) return null;
    const available = stock.find((s) => s.beerId === r.beerId && s.sizeId === r.sizeId)?.available ?? 0;
    const wanted = rows.filter((x) => x.beerId === r.beerId && x.sizeId === r.sizeId).reduce((s, x) => s + (Number.isFinite(qty(x)) ? qty(x) : 0), 0);
    const short = Math.max(0, wanted - available);
    return short > 0 ? <span className="text-warn">{available} full and free now. {short} would need filling.</span> : <span className="text-muted">{available} full and free now.</span>;
  };

  const submit = () => {
    // A line left blank at the end is ignored; two lines of the same beer and size become one.
    const filled = rows.some((r) => r.beerId) ? rows.filter((r) => r.beerId) : rows;
    const draft = { accountId, transit, dueOn: dueOn || null, lines: mergeLines(filled.map((r) => ({ beerId: r.beerId, sizeId: r.sizeId, quantity: qty(r) }))) };
    const v = validateOrder(draft);
    if ("error" in v) { setError(v.error); return; }
    start(async () => {
      const r = await createKegOrder({ ...v.order, note: note.trim() || null }).catch(() => ({ error: "Couldn't save the order. Check the connection and try again." }));
      if ("error" in r) setError(r.error);
      else router.push(`/kegs/orders/${r.id}`);
    });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
      <Card className="grid gap-4 p-4">
        <Field label="Account">
          <Select aria-label="Account" value={accountId} onChange={(e) => { setError(null); setAccountId(e.target.value); }} placeholder="Pick the account" options={ctx.accounts.map((a) => ({ value: a.id, label: a.name }))} searchable className="h-10 sm:h-9" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">Delivery or pickup</div>
            <TransitChoice value={transit} onChange={setTransit} />
          </div>
          <div>
            <div className="mb-1.5 text-[0.8rem] font-medium text-ink-2">Date <span className="font-normal text-muted">(optional)</span></div>
            <div className="flex gap-2">
              <DatePicker value={dueOn} today={today} onChange={(e) => setDueOn(e.target.value)} aria-label={transit === "PICKUP" ? "Pickup date" : "Delivery date"} className="h-10 sm:h-9" />
              {dueOn && <Button type="button" variant="ghost" className="h-10 shrink-0 sm:h-9" onClick={() => setDueOn("")}>No date</Button>}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-[0.95rem] font-semibold">Kegs</div>
        <p className="mt-0.5 text-sm text-muted">One line for each beer and size.</p>
        <ul className="mt-3 space-y-3">
          {rows.map((r, i) => (
            <li key={r.key}>
              <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_2.5rem] gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_4.5rem_2.5rem]">
                <div className="col-span-3 min-w-0 sm:col-span-1">
                  <Select aria-label={`Line ${i + 1} beer`} value={r.beerId} onChange={(e) => patch(r.key, { beerId: e.target.value })} placeholder="Pick the beer" options={ctx.beers.map((b) => ({ value: b.id, label: b.name }))} searchable className="h-10 sm:h-9" />
                </div>
                <Select aria-label={`Line ${i + 1} keg size`} value={r.sizeId} onChange={(e) => patch(r.key, { sizeId: e.target.value })} options={SIZES} className="h-10 sm:h-9" />
                <Input aria-label={`Line ${i + 1} how many`} value={r.quantity} onChange={(e) => patch(r.key, { quantity: e.target.value })} inputMode="numeric" autoComplete="off" maxLength={3} className="num text-right" />
                <Button type="button" variant="ghost" aria-label={`Remove line ${i + 1}`} className="h-10 w-10 px-0 sm:h-9" disabled={rows.length === 1} onClick={() => { setError(null); setRows((cur) => cur.filter((x) => x.key !== r.key)); }}>
                  <X className="size-4" />
                </Button>
              </div>
              <div className="mt-1 min-h-4 text-xs">{hint(r)}</div>
            </li>
          ))}
        </ul>
        <Button type="button" className="mt-1 h-10 sm:h-9" onClick={addRow}><Plus className="size-4" /> Add a line</Button>
      </Card>

      <Card className="p-4">
        <Field label="Note" hint="Optional. Anything the person loading the kegs should know.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Back door, ask for Sam" />
        </Field>
      </Card>

      {error && <p role="alert" className="rounded-xl bg-bad-bg px-4 py-2.5 text-sm font-medium text-bad">{error}</p>}
      <Button type="submit" variant="primary" size="lg" className="h-12 w-full sm:w-auto sm:px-8" disabled={pending}>{pending ? "Saving…" : "Create order"}</Button>
    </form>
  );
}
