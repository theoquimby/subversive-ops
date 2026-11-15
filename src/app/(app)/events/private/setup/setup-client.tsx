"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell } from "@/components/grid";
import { Badge, Button, Card, cx, Input, Select } from "@/components/ui";
import type { PrivateEventConfig, SpaceOption } from "@/domain/privateEvents";
import { money, pct } from "@/lib/format";
import type { quoteCatalog } from "@/server/services/privateEvents";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { addPackage, addPackageItem, removePackage, removePackageItem, removeSpace, setConfigField, setPackageField, setPackageItemPerGuest, setSpace } from "../actions";

type Pkg = Awaited<ReturnType<typeof quoteCatalog>>["allPackages"][number];
type Msg = { error?: string; message?: string } | null;

function Note({ msg }: { msg: Msg }) {
  if (!msg || (!msg.error && !msg.message)) return null;
  return <div role={msg.error ? "alert" : "status"} className={cx("mt-2 text-sm", msg.error ? "text-bad" : "text-good")}>{msg.error ?? msg.message}</div>;
}

function useRefreshing() {
  const router = useRouter();
  return <A extends unknown[]>(fn: (...a: A) => Promise<{ error?: string } | void>) =>
    async (...a: A) => {
      const r = await fn(...a);
      if (!r?.error) router.refresh();
      return r;
    };
}

// ---- Packages -------------------------------------------------------------------------

function PackageCard({ p, recipes }: { p: Pkg; recipes: { value: string; label: string; group: string }[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const refreshing = useRefreshing();
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const fc = p.costPerPerson != null && p.pricePerPerson > 0 ? p.costPerPerson / p.pricePerPerson : null;
  const run = (fn: () => Promise<{ error?: string; message?: string }>) => start(async () => { const r = await fn(); setMsg(r); if (!r.error) router.refresh(); });
  return (
    <Card className={cx("p-4", !p.active && "opacity-70")}>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <GridCell grid="pk" col="name" value={p.name} ariaLabel="Package name" onSave={refreshing((v: string) => setPackageField(p.id, "name", v))} className="text-base font-medium" />
        <GridCell grid="pk" col="price" type="number" decimals={2} prefix="$" suffix="pp" value={p.pricePerPerson} ariaLabel={`Price per person for ${p.name}`} onSave={refreshing((v: string) => setPackageField(p.id, "pricePerPerson", v))} />
      </div>
      <GridCell grid="pk" col="desc" value={p.description ?? ""} placeholder="What's included, for the quote (optional)" ariaLabel={`Description for ${p.name}`} onSave={refreshing((v: string) => setPackageField(p.id, "description", v))} className="mt-1 text-sm" />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>Food cost {p.costPerPerson != null ? <span className="num text-ink">{money(p.costPerPerson)} pp</span> : "—"}</span>
        {fc != null && <Badge tone={fc > 0.35 ? "warn" : "good"}>{pct(fc, 0)}</Badge>}
        {!p.active && <Badge>Hidden</Badge>}
      </div>
      <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
        {p.items.length === 0 && <li className="px-3 py-2 text-sm text-muted">No recipes yet.</li>}
        {p.items.map((it) => (
          <li key={it.id} className="flex items-center gap-2 px-3 py-1">
            <span className="min-w-0 flex-1 truncate text-sm">{it.name}</span>
            <GridCell grid={`pk-${p.id}`} col="per" type="number" value={it.perGuest} suffix="/guest" ariaLabel={`Portions per guest of ${it.name}`} onSave={refreshing((v: string) => setPackageItemPerGuest(it.id, v))} className="w-24" />
            <span className="num hidden w-16 text-right text-xs text-muted sm:block">{it.cost != null ? money(it.cost * it.perGuest) : "—"}</span>
            <Button size="sm" variant="ghost" className="size-10 p-0 sm:size-8" aria-label={`Remove ${it.name}`} disabled={pending} onClick={() => run(() => removePackageItem(it.id))}><Trash2 className="size-3.5" /></Button>
          </li>
        ))}
      </ul>
      <div className="mt-2">
        <Select value="" options={recipes} searchable placeholder="Add a recipe…" aria-label={`Add a recipe to ${p.name}`} disabled={pending} onChange={(e) => e.target.value && run(() => addPackageItem(p.id, e.target.value))} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" className="h-10 sm:h-8" disabled={pending} onClick={() => run(async () => (await setPackageField(p.id, "active", p.active ? "0" : "1")) ?? {})}>{p.active ? "Hide from quotes" : "Show on quotes"}</Button>
        <Button
          size="sm"
          variant="danger"
          className="h-10 sm:h-8"
          disabled={pending}
          onClick={async () => {
            const ok = await confirm({ title: `Delete ${p.name}?`, body: "If it's on a quote already, it's hidden instead.", confirmLabel: "Delete", danger: true });
            if (ok) run(() => removePackage(p.id));
          }}
        >
          Delete
        </Button>
      </div>
      <Note msg={msg} />
    </Card>
  );
}

export function PackagesEditor({ packages, recipes }: { packages: Pkg[]; recipes: { value: string; label: string; group: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const add = () =>
    start(async () => {
      const r = await addPackage(name, price);
      setMsg(r);
      if (!r.error) {
        setName("");
        setPrice("");
        router.refresh();
      }
    });
  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {packages.map((p) => <PackageCard key={p.id} p={p} recipes={recipes} />)}
      </div>
      <Card className="mt-3 p-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New package, e.g. Taproom buffet" aria-label="Package name" onKeyDown={(e) => e.key === "Enter" && add()} />
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">$</span>
            <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="per guest" aria-label="Price per guest" inputMode="decimal" className="num pl-6" onKeyDown={(e) => e.key === "Enter" && add()} />
          </div>
          <Button variant="primary" disabled={pending} onClick={add} className="h-10 sm:h-9"><Plus className="size-4" /> Add package</Button>
        </div>
        <Note msg={msg} />
      </Card>
    </div>
  );
}

// ---- Spaces ---------------------------------------------------------------------------

export function SpacesEditor({ spaces }: { spaces: SpaceOption[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const refreshing = useRefreshing();
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-border">
        {spaces.map((s, i) => (
          <li key={`${s.name}-${i}`} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
            <GridCell grid="sp" col="name" value={s.name} ariaLabel="Space name" onSave={refreshing((v: string) => setSpace(i, { name: v }))} className="min-w-0 flex-1 basis-40" />
            <GridCell grid="sp" col="cap" type="number" value={s.capacity ?? ""} placeholder="—" suffix="guests" ariaLabel={`Capacity of ${s.name}`} onSave={refreshing((v: string) => setSpace(i, { capacity: v }))} className="w-28" />
            <button
              type="button"
              role="switch"
              aria-checked={s.buyout}
              disabled={pending}
              onClick={() => start(async () => { const r = await setSpace(i, { buyout: !s.buyout }); setMsg(r?.error ? r : null); router.refresh(); })}
              className={cx("inline-flex h-10 items-center rounded-lg px-2.5 text-xs sm:h-8", s.buyout ? "bg-warn-bg text-warn" : "text-muted hover:bg-surface-2")}
            >
              {s.buyout ? "Buyout" : "Shared"}
            </button>
            <Button
              size="sm"
              variant="ghost"
              className="size-10 p-0 sm:size-8"
              aria-label={`Remove ${s.name}`}
              disabled={pending}
              onClick={async () => {
                const ok = await confirm({ title: `Remove ${s.name}?`, body: "Bookings already in it keep the name.", confirmLabel: "Remove", danger: true });
                if (ok) start(async () => { setMsg(await removeSpace(i)); router.refresh(); });
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 border-t border-border p-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a space" aria-label="New space" onKeyDown={(e) => e.key === "Enter" && name.trim() && start(async () => { const r = await setSpace(spaces.length, { name }); setMsg(r?.error ? r : null); if (!r?.error) { setName(""); router.refresh(); } })} />
        <Button disabled={pending || !name.trim()} className="h-10 shrink-0 sm:h-9" aria-label="Add space" onClick={() => start(async () => { const r = await setSpace(spaces.length, { name }); setMsg(r?.error ? r : null); if (!r?.error) { setName(""); router.refresh(); } })}><Plus className="size-4" /></Button>
      </div>
      <div className="px-3 pb-2"><Note msg={msg} /></div>
    </Card>
  );
}

// ---- Defaults -------------------------------------------------------------------------

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-1.5 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm text-ink">{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      <div className="w-28 shrink-0">{children}</div>
    </div>
  );
}

export function DefaultsCard({ cfg }: { cfg: PrivateEventConfig }) {
  const refreshing = useRefreshing();
  const p100 = (n: number, d = 2) => +(n * 100).toFixed(d);
  const f = (field: Parameters<typeof setConfigField>[0]) => refreshing((v: string) => setConfigField(field, v));
  return (
    <Card>
      <Row label="Sales tax" hint="Greene County, NY is 8%"><GridCell grid="cfg" col="v" type="number" suffix="%" value={p100(cfg.taxPct, 3)} ariaLabel="Sales tax percent" onSave={f("taxPct")} /></Row>
      <Row label="Service charge" hint="On food and bar, taxed"><GridCell grid="cfg" col="v" type="number" suffix="%" value={p100(cfg.serviceChargePct)} ariaLabel="Service charge percent" onSave={f("serviceChargePct")} /></Row>
      <Row label="Deposit" hint="Of the total, to hold the date"><GridCell grid="cfg" col="v" type="number" suffix="%" value={p100(cfg.depositPct)} ariaLabel="Deposit percent" onSave={f("depositPct")} /></Row>
      <Row label="Deposit due" hint="Days after the quote goes out"><GridCell grid="cfg" col="v" type="number" suffix="days" value={cfg.depositDueDays} ariaLabel="Deposit due days" onSave={f("depositDueDays")} /></Row>
      <Row label="Balance due" hint="Days before the event"><GridCell grid="cfg" col="v" type="number" suffix="days" value={cfg.balanceDueDays} ariaLabel="Balance due days" onSave={f("balanceDueDays")} /></Row>
      <Row label="Bar cost" hint="Share of bar sales, for the margin"><GridCell grid="cfg" col="v" type="number" suffix="%" value={p100(cfg.barCostPct)} ariaLabel="Bar cost percent" onSave={f("barCostPct")} /></Row>
    </Card>
  );
}
