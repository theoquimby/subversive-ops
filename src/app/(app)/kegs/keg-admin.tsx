"use client";

import { GridCell, GridSelect } from "@/components/grid";
import { Section } from "@/components/ui";
import { KEG_SIZE_LIST, OWNER_LABEL, type KegOwner } from "@/domain/kegs";
import type { KegCard } from "@/server/services/kegs";
import { setKegField } from "./actions";

/** Manager-only details for one keg, edited in place. */
export function KegAdmin({ card }: { card: KegCard }) {
  const row = (label: string, el: React.ReactNode) => (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-2 border-b border-border px-3 py-1 last:border-b-0">
      <span className="text-sm text-muted">{label}</span>
      <div className="min-w-0">{el}</div>
    </div>
  );
  return (
    <Section title="Keg details" description="Managers only. Saves as you go." className="mt-8">
      <div className="rounded-xl border border-border bg-surface">
        {row("Size", <GridSelect ariaLabel="Size" value={card.sizeId} options={KEG_SIZE_LIST.map((s) => ({ value: s.id, label: s.label }))} onSave={(v) => setKegField(card.id, "sizeId", v)} />)}
        {row("Owner", <GridSelect ariaLabel="Owner" value={card.owner} options={(Object.keys(OWNER_LABEL) as KegOwner[]).map((o) => ({ value: o, label: OWNER_LABEL[o] }))} onSave={(v) => setKegField(card.id, "owner", v)} />)}
        {row("Old sticker", <GridCell grid="keg" col="legacy" ariaLabel="Old sticker code" value={card.legacyCode} placeholder="From the old keg app" onSave={(v) => setKegField(card.id, "legacyCode", v)} />)}
        {row("Label", <GridCell grid="keg" col="label" ariaLabel="Label" value={card.label} placeholder="e.g. dented, blue cap" onSave={(v) => setKegField(card.id, "label", v)} />)}
        {row("Notes", <GridCell grid="keg" col="notes" ariaLabel="Notes" value={card.notes} placeholder="—" onSave={(v) => setKegField(card.id, "notes", v)} />)}
        {row("In service", <GridSelect ariaLabel="In service" value={card.active ? "true" : "false"} options={[{ value: "true", label: "Yes" }, { value: "false", label: "Retired" }]} onSave={(v) => setKegField(card.id, "active", v)} />)}
      </div>
    </Section>
  );
}
