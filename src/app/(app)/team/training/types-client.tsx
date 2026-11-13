"use client";

import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { Card, cx } from "@/components/ui";
import type { TypeView } from "@/server/services/training";
import { Check, Trash2 } from "lucide-react";
import { useTransition } from "react";
import { AddRow } from "../team-client";
import { addCertType, deleteCertType, setCertTypeField, setCertTypePosition } from "./actions";
import type { PositionOpt } from "./matrix-client";

const YES_NO = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];
const ACTIVE = [{ value: "yes", label: "In use" }, { value: "no", label: "Archived" }];
const th = "border-b border-border px-4 py-2.5 text-left text-[0.75rem] font-medium whitespace-nowrap text-muted";
const td = "border-b border-border px-2 py-1 align-middle [tr:last-child_&]:border-b-0";

/** Inline-editable certificate types: name, validity, which positions need it, everyone / minors. */
export function CertTypesGrid({ types, positions }: { types: TypeView[]; positions: PositionOpt[] }) {
  return (
    <Card className="overflow-x-auto" data-tour="training.types">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className={th}>Certificate</th>
            <th className={cx(th, "w-20 text-right sm:w-28")}><span className="sm:hidden">Months</span><span className="hidden sm:inline">Valid (months)</span></th>
            <th className={cx(th, "hidden md:table-cell")}>Required for positions</th>
            <th className={cx(th, "hidden w-24 sm:table-cell")}>Everyone</th>
            <th className={cx(th, "hidden w-24 lg:table-cell")}>Minors</th>
            <th className={cx(th, "hidden w-28 lg:table-cell")}>Status</th>
            <th className={cx(th, "hidden w-24 text-right xl:table-cell")}>In date</th>
            <th className="w-12 border-b border-border" />
          </tr>
        </thead>
        <tbody>
          {types.map((t) => (
            <tr key={t.id} className={cx("transition-colors hover:bg-surface-2/60", !t.active && "opacity-55")}>
              <td className={td}>
                <GridCell grid="ct" col="name" value={t.name} onSave={setCertTypeField.bind(null, t.id, "name")} ariaLabel="Certificate name" className="min-w-40 font-medium" />
                <GridCell grid="ct" col="issuer" value={t.issuer} placeholder="Issued by…" onSave={setCertTypeField.bind(null, t.id, "issuer")} ariaLabel={`${t.name} issuer`} className="text-xs text-muted [&_input]:h-7 [&_input]:text-xs" />
                <div className="space-y-1 px-2 pb-1.5 md:hidden">
                  <PositionToggles typeId={t.id} assigned={t.appliesTo} positions={positions} requiredForAll={t.requiredForAll} />
                  <div className="flex flex-wrap gap-1 sm:hidden">
                    <FlagToggle typeId={t.id} field="requiredForAll" on={t.requiredForAll} label="Everyone" />
                    <FlagToggle typeId={t.id} field="requiredForMinors" on={t.requiredForMinors} label="Minors" />
                  </div>
                </div>
                {t.isAnnualTraining && <div className="px-2 pb-1 text-[11px] text-muted">Yearly training</div>}
              </td>
              <td className={td}>
                <GridCell grid="ct" col="validity" type="number" value={t.validityMonths} placeholder="Never" onSave={setCertTypeField.bind(null, t.id, "validityMonths")} ariaLabel={`${t.name} months valid`} />
              </td>
              <td className={cx(td, "hidden min-w-[18rem] md:table-cell")}>
                <PositionToggles typeId={t.id} assigned={t.appliesTo} positions={positions} requiredForAll={t.requiredForAll} />
              </td>
              <td className={cx(td, "hidden sm:table-cell")}>
                <GridSelect value={t.requiredForAll ? "yes" : "no"} options={YES_NO} onSave={setCertTypeField.bind(null, t.id, "requiredForAll")} ariaLabel={`${t.name} required for everyone`} />
              </td>
              <td className={cx(td, "hidden lg:table-cell")}>
                <GridSelect value={t.requiredForMinors ? "yes" : "no"} options={YES_NO} onSave={setCertTypeField.bind(null, t.id, "requiredForMinors")} ariaLabel={`${t.name} required for minors`} />
              </td>
              <td className={cx(td, "hidden lg:table-cell")}>
                <GridSelect value={t.active ? "yes" : "no"} options={ACTIVE} onSave={setCertTypeField.bind(null, t.id, "active")} ariaLabel={`${t.name} in use`} />
              </td>
              <td className={cx(td, "num hidden px-4 text-right text-muted xl:table-cell")}>{t.requiredCount ? `${t.okCount}/${t.requiredCount}` : "—"}</td>
              <td className={cx(td, "text-right")}><DeleteType id={t.id} name={t.name} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <AddRow placeholder="Add a certificate type, e.g. Forklift" label="Add certificate type" onAdd={addCertType} />
    </Card>
  );
}

/** Multi-select chips: tap a position to require (or stop requiring) the certificate for it. */
function PositionToggles({ typeId, assigned, positions, requiredForAll }: { typeId: string; assigned: string[]; positions: PositionOpt[]; requiredForAll: boolean }) {
  const [pending, start] = useTransition();
  if (requiredForAll) return <span className="px-1 text-xs text-muted">Everyone, whatever their position</span>;
  return (
    <div className={cx("flex flex-wrap gap-1", pending && "opacity-60")} role="group" aria-label="Required for positions">
      {positions.map((p) => {
        const on = assigned.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            disabled={pending}
            onClick={() => start(async () => { await setCertTypePosition(typeId, p.id, !on); })}
            className={cx(
              "inline-flex h-9 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors duration-120 ease-motion sm:h-7",
              on ? "border-ink/80 bg-primary text-primary-ink" : "border-border-strong text-ink-2 hover:bg-surface-2",
            )}
          >
            {on ? <Check className="size-3" /> : <span className="size-1.5 rounded-full" style={{ background: p.color }} />}
            {p.name}
          </button>
        );
      })}
    </div>
  );
}

/** Phones: the Everyone / Minors columns are hidden, so they're chips under the name. */
function FlagToggle({ typeId, field, on, label }: { typeId: string; field: "requiredForAll" | "requiredForMinors"; on: boolean; label: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" aria-pressed={on} disabled={pending} onClick={() => start(async () => { await setCertTypeField(typeId, field, on ? "no" : "yes"); })}
      className={cx("inline-flex h-9 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors duration-120 ease-motion", on ? "border-ink/80 bg-primary text-primary-ink" : "border-border-strong text-ink-2", pending && "opacity-60")}>
      {on && <Check className="size-3" />}Required for {label.toLowerCase()}
    </button>
  );
}

function DeleteType({ id, name }: { id: string; name: string }) {
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label={`Delete ${name}`}
      disabled={pending}
      onClick={async () => {
        if (!(await confirm({ title: `Delete ${name}?`, body: "Only possible while no certificates are on file for it. Otherwise archive it.", confirmLabel: "Delete", danger: true }))) return;
        start(async () => {
          const r = await deleteCertType(id);
          if (r?.error) await confirm({ title: "Can't delete it yet", body: r.error, confirmLabel: "OK" });
        });
      }}
      className="grid size-10 place-items-center rounded-md text-muted hover:bg-bad-bg hover:text-bad sm:size-8"
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}
